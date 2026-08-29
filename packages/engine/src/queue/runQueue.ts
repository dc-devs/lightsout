import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitDefaultBranch } from '#src/common/git/readGitDefaultBranch.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { type LightsoutConfig, PipelineKind, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QuestionRelay } from '#src/queue/common/services/QuestionRelay.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { dedupeTickets } from '#src/queue/dedupeTickets.ts';
import { drainTickets } from '#src/queue/drainTickets.ts';
import { runQueueTicket } from '#src/queue/runQueueTicket.ts';
import { scanParkedWorktrees } from '#src/queue/scanParkedWorktrees.ts';
import { shipReadyBranches } from '#src/queue/shipReadyBranches.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import { listEligibleTickets } from '#src/queue/tracker/index.ts';
import { createRun, getRunDir, seedUsageTotals, withRunLock, writeManifestWithUsage } from '#src/runState/index.ts';
import { readTicketMatch, type ShipSettings } from '#src/ship/index.ts';

interface Params {
	cwd: string;
	settings: QueueSettings;
	shipSettings: ShipSettings;
	config: LightsoutConfig;
	driver: Driver;
	driverName: string;
	relay: QuestionRelay;
	onProgress?: (message: string) => void;
}

/**
 * The two things the drain cannot start without: a branch template whose output
 * the ship pattern matches, and a remote default branch to cut from.
 *
 * A branch template the ticket pattern cannot read would make every resumed
 * ticket's identifier underivable, so it is refused up front, naming both keys
 * — a config-usability refusal, never a workflow one.
 */
// Annotated because inference would widen each branch with the other's absent
// key, and `'error' in started` could no longer narrow the union at the call site.
const checkQueueStartup = async ({
	cwd,
	settings,
	shipSettings,
}: Pick<Params, 'cwd' | 'settings' | 'shipSettings'>): Promise<QueueFailure | { defaultBranch: string }> => {
	const sample: TicketSummary = { id: 'sample', identifier: 'AB-1', title: 'sample', description: '', priority: 0, createdAt: '', route: QueueRoute.Direct };
	const rendered = toTicketBranch({ ticket: sample, template: settings.branchTemplate });

	if (readTicketMatch({ branch: rendered, ticketPattern: shipSettings.ticketPattern }) === undefined) {
		return {
			error: `\`queue.branch-template\` renders '${rendered}', which \`ship.ticket-pattern\` does not match — every queued branch would be unshippable`,
		};
	}

	const defaultBranch = await readGitDefaultBranch({ cwd });

	if (defaultBranch === undefined) {
		return { error: 'the queue needs a default branch: `origin/HEAD` is unset — run `git remote set-head origin --auto`' };
	}

	// One fetch for the whole drain: every worktree creation builds on it, and
	// concurrent fetches in the main checkout add nothing but contention.
	await runCommand({ command: 'git fetch origin', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	return { defaultBranch };
};

/** Priority first, then oldest — how a human drains a backlog. Linear's 0 means "no priority", so it sorts last rather than first. */
const orderTickets = ({ tickets }: { tickets: TicketSummary[] }) => {
	const rank = ({ priority }: TicketSummary) => (priority === 0 ? 5 : priority);

	return [...tickets].sort((left, right) => rank(left) - rank(right) || left.createdAt.localeCompare(right.createdAt));
};

/** The coordinator run's document: one line per ticket, naming the route, the branch and the worktree a human can reach it in. */
const writeQueuePlan = ({ path, queued, settings, cwd }: { path: string; queued: TicketSummary[]; settings: QueueSettings; cwd: string }) => {
	const root = getWorktreesRoot({ cwd });
	const lines = queued.map((ticket) => {
		const branch = toTicketBranch({ ticket, template: settings.branchTemplate });

		return `- ${ticket.identifier} · ${ticket.route} · ${branch} · ${join(root, branch)}`;
	});

	return writeFile(path, `# queue drain\n\n${lines.join('\n')}\n`, 'utf8');
};

/** One promise tail every `git worktree add` awaits and replaces — creation mutates the main checkout, so two of them must never overlap. */
const createWorktreeSerializer = () => {
	let tail: Promise<unknown> = Promise.resolve();

	return <Result>(task: () => Promise<Result>): Promise<Result> => {
		const next = tail.then(task, task);

		tail = next.catch(() => undefined);

		return next;
	};
};

/** The locked half of a drain: the coordinator run, the tickets, then the serial merge. */
const drainAndShip = async ({
	cwd,
	runId,
	settings,
	shipSettings,
	config,
	driver,
	driverName,
	relay,
	defaultBranch,
	queued,
	parked,
	skipped,
	onProgress,
}: Params & { runId: string; defaultBranch: string; queued: TicketSummary[]; parked: ParkedWork; skipped: LeftBehindTicket[] }) => {
	const coordinatorRunDir = getRunDir({ cwd, runId });
	const planPath = join(coordinatorRunDir, 'queue.md');
	const manifest = await createRun({ cwd, runId, plan: planPath, pipeline: PipelineKind.Queue, driver: driverName, config });

	await writeQueuePlan({ path: planPath, queued, settings, cwd });
	await writeManifestWithUsage({ cwd, manifest, patch: { status: RunStatus.Running }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	const serializeWorktreeAdd = createWorktreeSerializer();
	const drained = await drainTickets({
		queued,
		maxParallel: settings.maxParallel,
		onProgress,
		runTicket: ({ ticket }) =>
			runQueueTicket({
				cwd,
				settings,
				ticket,
				config,
				driver,
				driverName,
				defaultBranch,
				relay,
				serializeWorktreeAdd,
				coordinatorRunId: runId,
				coordinatorRunDir,
				onProgress: relay.createProgressSink({ ticket }),
			}),
	});

	const settled = [...parked.outcomes, ...drained.outcomes];
	const ready = settled.filter((outcome) => outcome.ready);
	const shipped = await shipReadyBranches({ cwd, config, shipSettings, defaultBranch, ready, onProgress });
	const outcomes = [...shipped, ...settled.filter((outcome) => !outcome.ready)];
	const leftBehind = [...parked.leftBehind, ...skipped, ...drained.leftBehind];
	const status = outcomes.every((outcome) => outcome.ready) && leftBehind.length === 0 ? RunStatus.Passed : RunStatus.Escalated;

	await writeManifestWithUsage({ cwd, manifest, patch: { status, currentStep: null }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	const report: QueueDrainReport = { outcomes, leftBehind };

	return report;
};

/**
 * The supervisor: read the tracker, drain what it finds into parallel
 * worktrees, then merge the ready branches one at a time — and exit.
 *
 * Parked runs come first, because a restart is the resume path: their tickets
 * sit at the in-progress status where the eligible query cannot see them, so
 * they are found on disk instead. Steps from the coordinator run onward hold
 * the repo's run lock, which is what makes two concurrent `lightsout queue`
 * invocations impossible; each worker takes its own lock in its own worktree,
 * so the two never contend.
 */
export const runQueue = async ({
	cwd,
	settings,
	shipSettings,
	config,
	driver,
	driverName,
	relay,
	onProgress,
}: Params): Promise<QueueDrainReport | QueueFailure> => {
	const started = await checkQueueStartup({ cwd, settings, shipSettings });

	if ('error' in started) {
		return started;
	}

	const { defaultBranch } = started;
	const eligible = await listEligibleTickets({ settings });

	if ('error' in eligible) {
		return eligible;
	}

	const parked = await scanParkedWorktrees({ cwd, defaultBranch, settings, shipSettings, onProgress });

	if ('error' in parked) {
		return parked;
	}

	const { ordered, leftBehind } = dedupeTickets({ tickets: [...parked.resumed, ...orderTickets({ tickets: eligible })], settings, onProgress });

	if (ordered.length === 0 && parked.outcomes.length === 0) {
		onProgress?.('nothing to do — no eligible tickets, and no parked worktrees to pick up');

		const empty: QueueDrainReport = { outcomes: [], leftBehind: [...parked.leftBehind, ...leftBehind] };

		return empty;
	}

	return withRunLock({
		params: { cwd, onProgress },
		run: ({ runId }) =>
			drainAndShip({
				cwd,
				runId,
				settings,
				shipSettings,
				config,
				driver,
				driverName,
				relay,
				defaultBranch,
				queued: ordered,
				parked,
				skipped: leftBehind,
				onProgress,
			}),
	});
};

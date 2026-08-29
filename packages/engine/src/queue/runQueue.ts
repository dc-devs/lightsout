import { join } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitDefaultBranch } from '#src/common/git/readGitDefaultBranch.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { type LightsoutConfig, PipelineKind, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { drainWaves } from '#src/queue/drainWaves.ts';
import { orderTickets } from '#src/queue/orderTickets.ts';
import { runQueueTicket } from '#src/queue/runQueueTicket.ts';
import { scanParkedWorktrees } from '#src/queue/scanParkedWorktrees.ts';
import { selectWaveTickets } from '#src/queue/selectWaveTickets.ts';
import { settleParkedLabels } from '#src/queue/settleParkedLabels.ts';
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
	// The sample is shaped from the configured team key, so the check exercises
	// a branch name shaped like the repo's real ones — a hardcoded key would
	// false-alarm on every `ship.ticket-pattern` scoped to its own team.
	const sample: TicketSummary = {
		id: 'sample',
		identifier: `${settings.team}-1`,
		title: 'sample',
		description: '',
		priority: 0,
		createdAt: '',
		route: QueueRoute.Direct,
		unfinishedBlockers: [],
	};
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

/** One promise tail every `git worktree add` awaits and replaces — creation mutates the main checkout, so two of them must never overlap. */
const createWorktreeSerializer = () => {
	let tail: Promise<unknown> = Promise.resolve();

	return <Result>(task: () => Promise<Result>): Promise<Result> => {
		const next = tail.then(task, task);

		tail = next.catch(() => undefined);

		return next;
	};
};

/** The locked half of a drain: the coordinator run, the waves, then the settled labels. */
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
	first,
	parked,
	onProgress,
}: Params & { runId: string; defaultBranch: string; first: WaveSelection; parked: ParkedWork }) => {
	const coordinatorRunDir = getRunDir({ cwd, runId });
	const planPath = join(coordinatorRunDir, 'queue.md');
	const manifest = await createRun({ cwd, runId, plan: planPath, pipeline: PipelineKind.Queue, driver: driverName, config });

	await writeManifestWithUsage({ cwd, manifest, patch: { status: RunStatus.Running }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	const serializeWorktreeAdd = createWorktreeSerializer();
	const drained = await drainWaves({
		cwd,
		settings,
		shipSettings,
		config,
		defaultBranch,
		planPath,
		first,
		parked,
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
	const status = drained.outcomes.every((outcome) => outcome.ready) && drained.leftBehind.length === 0 ? RunStatus.Passed : RunStatus.Escalated;

	// One call is the whole park/ship label story: shipping has already flipped
	// `ready` on anything it could not merge, so a ship-step park is labelled by
	// the same line that labels a worker park.
	await settleParkedLabels({ settings, outcomes: drained.outcomes, onProgress });
	await writeManifestWithUsage({ cwd, manifest, patch: { status, currentStep: null }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	return drained;
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
 *
 * The drain runs in waves — everything unblocked, ship, re-scan — and stops when
 * a scan finds nothing newly runnable. The run lock and the coordinator run are
 * still one per invocation, and the parked worktree scan still runs only before
 * the first wave.
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

	const first = selectWaveTickets({ tickets: [...parked.resumed, ...orderTickets({ tickets: eligible })], settings, attempted: new Set<string>(), onProgress });

	if (first.runnable.length === 0 && parked.outcomes.length === 0) {
		onProgress?.(
			first.blocked.length > 0
				? 'nothing to do — every eligible ticket is waiting on an unfinished blocker'
				: 'nothing to do — no eligible tickets, and no parked worktrees to pick up',
		);

		const empty: QueueDrainReport = { outcomes: [], leftBehind: [...parked.leftBehind, ...first.skipped, ...first.blocked] };

		return empty;
	}

	return withRunLock({
		params: { cwd, onProgress },
		run: ({ runId }) => drainAndShip({ cwd, runId, settings, shipSettings, config, driver, driverName, relay, defaultBranch, first, parked, onProgress }),
	});
};

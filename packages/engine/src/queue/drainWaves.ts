import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { settleMergedTrees } from '#src/queue/common/utils/settleMergedTrees.ts';
import { listNextWave } from '#src/queue/listNextWave.ts';
import { reconcileMergedTickets } from '#src/queue/reconcileMergedTickets.ts';
import { runQueueWave } from '#src/queue/runQueueWave.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	defaultBranch: string;
	/** Where the coordinator run's `queue.md` is written. */
	planPath: string;
	/** The first wave's selection, built from the parked scan and the opening tracker read. */
	first: WaveSelection;
	parked: ParkedWork;
	runTicket: (params: { ticket: RunnableTicket }) => Promise<TicketRunOutcome>;
	onProgress?: (message: string) => void;
}

/** The coordinator run's document: one line per ticket, naming the worker, the branch and the worktree a human can reach it in. */
const writeQueuePlan = ({ path, queued, settings, cwd }: { path: string; queued: RunnableTicket[]; settings: QueueSettings; cwd: string }) => {
	const root = getWorktreesRoot({ cwd });
	const lines = queued.map((ticket) => {
		const branch = toTicketBranch({ ticket, template: settings.branchTemplate });

		return `- ${ticket.identifier} · ${ticket.worker} · ${branch} · ${join(root, branch)}`;
	});

	return writeFile(path, `# queue drain\n\n${lines.join('\n')}\n`, 'utf8');
};

/** The identifiers the parked scan already settled — attempted before the first wave even starts. */
const toParkedIdentifiers = ({ parked }: { parked: ParkedWork }) => [
	...parked.outcomes.map((outcome) => outcome.ticket.identifier),
	...parked.leftBehind.map((entry) => entry.identifier),
	...parked.merged.map((tree) => tree.ticket.identifier),
];

/** Remember a scan's held-back tickets, so one stays reportable even after later scans stop returning it. */
const rememberBlocked = ({ blockedByIdentifier, entries }: { blockedByIdentifier: Map<string, LeftBehindTicket>; entries: LeftBehindTicket[] }) => {
	for (const entry of entries) {
		blockedByIdentifier.set(entry.identifier.toLowerCase(), entry);
	}
};

/**
 * The selection a wave actually runs: the tickets whose branches have not
 * already merged, with the reconciled ones moved into this scan's settled skips.
 *
 * They join the skips rather than sitting beside them because that is what marks
 * them attempted — no later scan offers work that already shipped — and it is
 * the one path every other settled ticket reaches the report by.
 */
const settleMergedWaveTickets = async ({
	cwd,
	config,
	env,
	settings,
	selection,
	onProgress,
}: {
	cwd: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	settings: QueueSettings;
	selection: WaveSelection;
	onProgress?: (message: string) => void;
}) => {
	const reconciled = await reconcileMergedTickets({ cwd, config, env, settings, tickets: selection.runnable, onProgress });

	return { ...selection, runnable: reconciled.kept, skipped: [...selection.skipped, ...reconciled.leftBehind] };
};

/**
 * The next wave's selection, or undefined when the drain is finished.
 *
 * A re-scan that fails and a re-scan that finds nothing newly runnable both end
 * the loop, but they leave different things behind: the failure says so, and the
 * empty answer still records what it saw held back or skipped.
 */
const advanceToNextWave = async ({
	settings,
	trackerSettings,
	attempted,
	blockedByIdentifier,
	leftBehind,
	onProgress,
}: {
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	attempted: Set<string>;
	blockedByIdentifier: Map<string, LeftBehindTicket>;
	leftBehind: LeftBehindTicket[];
	onProgress?: (message: string) => void;
}) => {
	const next = await listNextWave({ settings, trackerSettings, attempted, onProgress });

	if ('error' in next) {
		onProgress?.(`the re-scan for newly unblocked tickets failed, so the drain stops here: ${next.error}`);

		return undefined;
	}

	if (next.runnable.length === 0) {
		rememberBlocked({ blockedByIdentifier, entries: next.blocked });
		leftBehind.push(...next.skipped);

		return undefined;
	}

	return next;
};

/** Every identifier a wave is done with: never offered to another one, and no longer waiting on a blocker. */
const settleWave = ({
	attempted,
	blockedByIdentifier,
	selection,
	wave,
}: {
	attempted: Set<string>;
	blockedByIdentifier: Map<string, LeftBehindTicket>;
	selection: WaveSelection;
	wave: QueueDrainReport;
}) => {
	const identifiers = [
		...selection.runnable.map((ticket) => ticket.identifier),
		...selection.skipped.map((entry) => entry.identifier),
		...wave.leftBehind.map((entry) => entry.identifier),
	];

	for (const identifier of identifiers) {
		attempted.add(identifier.toLowerCase());
		blockedByIdentifier.delete(identifier.toLowerCase());
	}
};

/**
 * Wave after wave until a scan finds nothing newly runnable.
 *
 * Only tickets held back as blocked stay candidates: every identifier a wave was
 * offered is recorded as attempted and never offered again, whatever became of
 * it. That is what makes the loop terminate, and it is why a parked ticket is
 * never re-resumed inside one invocation to re-ask the same question.
 *
 * The report is the FINAL state, not a log of every wave: a ticket blocked in an
 * early wave that ran in a later one appears only as an outcome, and a ticket
 * still blocked at the end appears exactly once in `leftBehind`.
 *
 * It opens by finishing the parked worktrees already recorded merged — work
 * that writes tickets to Done, so it waits for this function's run lock.
 */
export const drainWaves = async ({
	cwd,
	settings,
	trackerSettings,
	shipSettings,
	config,
	env,
	defaultBranch,
	planPath,
	first,
	parked,
	runTicket,
	onProgress,
}: Params): Promise<QueueDrainReport> => {
	const outcomes: TicketRunOutcome[] = [];
	const leftBehind: LeftBehindTicket[] = [...parked.leftBehind];
	const attempted = new Set<string>(toParkedIdentifiers({ parked }).map((identifier) => identifier.toLowerCase()));
	// Every ticket ever held back as blocked, keyed by lower-cased identifier.
	// A later scan cannot return a resumed ticket (its status is in-progress, and
	// the eligible query filters on status), so the report must not depend on the
	// ticket staying visible: an entry leaves this map only by becoming an
	// outcome or a skip, and whatever remains at the end is left behind exactly
	// once — a ticket must never vanish from the summary.
	const blockedByIdentifier = new Map<string, LeftBehindTicket>();
	const queuedSoFar: RunnableTicket[] = [];
	let selection = first;
	let carried = parked.outcomes;
	leftBehind.push(...(await settleMergedTrees({ cwd, config, env, settings, trackerSettings, merged: parked.merged, onProgress })));

	for (;;) {
		// Before any worktree is created or any tracker write is made: a ticket
		// whose branch already carries a merged pull request is reconciled to done
		// and skipped, so no worker is spent on work that already shipped.
		selection = await settleMergedWaveTickets({ cwd, config, env, settings, selection, onProgress });
		queuedSoFar.push(...selection.runnable);
		rememberBlocked({ blockedByIdentifier, entries: selection.blocked });

		await writeQueuePlan({ path: planPath, queued: queuedSoFar, settings, cwd });

		const wave = await runQueueWave({
			cwd,
			config,
			shipSettings,
			defaultBranch,
			env,
			queued: selection.runnable,
			maxParallel: settings.maxParallel,
			carried,
			runTicket,
			onProgress,
		});

		outcomes.push(...wave.outcomes);
		leftBehind.push(...selection.skipped, ...wave.leftBehind);
		settleWave({ attempted, blockedByIdentifier, selection, wave });

		// The parked scan's outcomes are settled once: carrying them into a second
		// wave would ship or report them twice.
		carried = [];

		if (selection.blocked.length === 0) {
			break;
		}

		const next = await advanceToNextWave({ settings, trackerSettings, attempted, blockedByIdentifier, leftBehind, onProgress });

		if (next === undefined) {
			break;
		}

		selection = next;
	}

	leftBehind.push(...blockedByIdentifier.values());

	const report: QueueDrainReport = { outcomes, leftBehind };

	return report;
};

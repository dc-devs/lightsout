import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { settleMergedTrees } from '#src/queue/common/utils/settleMergedTrees.ts';
import { runDrainLanes } from '#src/queue/drainLanes/index.ts';
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
	/** The opening selection, built from the parked scan and the opening tracker read. */
	first: WaveSelection;
	parked: ParkedWork;
	runTicket: (params: { ticket: RunnableTicket }) => Promise<TicketRunOutcome>;
	/** Runs a task with no other main-checkout git mutation in flight — one chain per drain, created in `runQueue.ts` and threaded down. */
	serializeMainCheckout: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	onProgress?: (message: string) => void;
}

/** The identifiers the parked scan already settled — attempted before the drain even starts. */
const toParkedIdentifiers = ({ parked }: { parked: ParkedWork }) => [
	...parked.outcomes.map((outcome) => outcome.ticket.identifier),
	...parked.leftBehind.map((entry) => entry.identifier),
	...parked.merged.map((tree) => tree.ticket.identifier),
];

/**
 * The whole drain: parallel builders and one serial ship lane running at the
 * same time, with each landed merge re-reading the tracker so the tickets it
 * unblocked join the run already in flight.
 *
 * Only tickets held back as blocked stay candidates: every identifier a scan was
 * offered is recorded as attempted and never offered again, whatever became of
 * it. That is what makes the drain terminate, and it is why a parked ticket is
 * never re-resumed inside one invocation to re-ask the same question.
 *
 * The report is the FINAL state, not a log: a ticket blocked by an early scan
 * that later ran appears only as an outcome, and a ticket still blocked at the
 * end appears exactly once in `leftBehind`.
 *
 * It opens by finishing the parked worktrees already recorded merged — work
 * that writes tickets to Done, so it waits for this function's run lock.
 */
export const drainQueue = async ({
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
	serializeMainCheckout,
	onProgress,
}: Params): Promise<QueueDrainReport> => {
	const leftBehind: LeftBehindTicket[] = [...parked.leftBehind];
	const attempted = new Set<string>(toParkedIdentifiers({ parked }).map((identifier) => identifier.toLowerCase()));

	leftBehind.push(...(await settleMergedTrees({ cwd, config, env, settings, trackerSettings, merged: parked.merged, onProgress })));

	const drained = await runDrainLanes({
		cwd,
		config,
		settings,
		trackerSettings,
		shipSettings,
		defaultBranch,
		env,
		planPath,
		first,
		carried: parked.outcomes,
		attempted,
		runTicket,
		serializeMainCheckout,
		onProgress,
	});
	const report: QueueDrainReport = { outcomes: drained.outcomes, leftBehind: [...leftBehind, ...drained.leftBehind] };

	return report;
};

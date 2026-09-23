import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateHolds } from '#src/gates/index.ts';
import type { QueueBoardRecorder } from '#src/queue/board/index.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { ShipIntegration, ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

/** Everything the drain's lanes need that never changes while one drain runs. */
export interface LaneContext {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	/** The coordinator run's own id, so a hold the ship lane takes names the run that took it. */
	runId: string;
	/** The holds reconciled once at the drain's start, read by every re-scan. */
	holds: GateHolds;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	/** The effective config and harness the merge lane's integration step verifies and repairs with. */
	shipIntegration: ShipIntegration;
	/**
	 * The harness the wave's naming step spawns to summarise a ticket's title.
	 *
	 * Threaded rather than taken from `shipIntegration`, whose driver is the
	 * merge lane's repair harness and means something else.
	 */
	driver: Driver;
	defaultBranch: string;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	/** Where the coordinator run's queue document is written, rewritten every time tickets are admitted. */
	planPath: string;
	/** One work order, from worktree to committed-and-ready. */
	runWorkOrder: (params: { workOrder: NamedWorkOrder }) => Promise<WorkOrderRunOutcome>;
	/**
	 * Runs a task with no other main-checkout git mutation in flight. A builder's
	 * worktree creation, the merge tail's removal and the re-scan's removal never
	 * overlapped while merging waited for every build; this drain removes that
	 * ordering, so it has to keep them apart. Passed in because the builders'
	 * creation already takes the chain `runQueue.ts` captured in `runWorkOrder`.
	 */
	serializeMainCheckout: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	/** The coordinator run's board. The drain only records a snapshot into it on each pass, and never awaits the write. */
	board: Pick<QueueBoardRecorder, 'record'>;
	onProgress?: (message: string) => void;
}

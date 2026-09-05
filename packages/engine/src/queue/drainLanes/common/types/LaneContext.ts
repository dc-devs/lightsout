import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

/** Everything the drain's lanes need that never changes while one drain runs. */
export interface LaneContext {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	defaultBranch: string;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	/** Where the coordinator run's queue document is written, rewritten every time tickets are admitted. */
	planPath: string;
	/** One ticket, from worktree to committed-and-ready. */
	runTicket: (params: { ticket: RunnableTicket }) => Promise<TicketRunOutcome>;
	/**
	 * Runs a task with no other main-checkout git mutation in flight. A builder's
	 * worktree creation, the merge tail's removal and the re-scan's removal never
	 * overlapped while merging waited for every build; this drain removes that
	 * ordering, so it has to keep them apart. Passed in because the builders'
	 * creation already takes the chain `runQueue.ts` captured in `runTicket`.
	 */
	serializeMainCheckout: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	onProgress?: (message: string) => void;
}

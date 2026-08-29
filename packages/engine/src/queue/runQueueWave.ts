import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { drainTickets } from '#src/queue/drainTickets.ts';
import { shipReadyBranches } from '#src/queue/shipReadyBranches.ts';
import type { ShipSettings } from '#src/ship/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	shipSettings: ShipSettings;
	defaultBranch: string;
	/** Tickets this wave works, in the order they will be picked up. */
	queued: TicketSummary[];
	maxParallel: number;
	/** Outcomes settled before this wave's drain — the parked scan's, on the first wave only. */
	carried: TicketRunOutcome[];
	/** One ticket, from worktree to committed-and-ready. */
	runTicket: (params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>;
	onProgress?: (message: string) => void;
}

/**
 * One wave of the drain: work the tickets, then merge what is ready.
 *
 * Every wave ships, because a blocker's ticket only reaches a finished status
 * once its PR is merged — a drain that shipped only at the end could never
 * unblock a dependent inside the same run.
 */
export const runQueueWave = async ({
	cwd,
	config,
	shipSettings,
	defaultBranch,
	queued,
	maxParallel,
	carried,
	runTicket,
	onProgress,
}: Params): Promise<QueueDrainReport> => {
	const drained = await drainTickets({ queued, maxParallel, runTicket, onProgress });
	const settled = [...carried, ...drained.outcomes];
	const ready = settled.filter((outcome) => outcome.ready);
	const shipped = await shipReadyBranches({ cwd, config, shipSettings, defaultBranch, ready, onProgress });
	const outcomes = [...shipped, ...settled.filter((outcome) => !outcome.ready)];
	const report: QueueDrainReport = { outcomes, leftBehind: drained.leftBehind };

	return report;
};

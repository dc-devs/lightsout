import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { LeftBehindTicket } from '#src/queue/internal/common/types/LeftBehindTicket.ts';

/**
 * What one drain amounted to.
 *
 * `leftBehind` is beside the outcomes rather than folded into them because a
 * ticket the drain touched and deliberately did not run — an ambiguous-label skip,
 * a slot budget that ran out — never became an outcome, and a ticket must never
 * vanish from the summary just because nothing ran it.
 */
export interface QueueDrainReport {
	outcomes: WorkOrderRunOutcome[];
	leftBehind: LeftBehindTicket[];
}

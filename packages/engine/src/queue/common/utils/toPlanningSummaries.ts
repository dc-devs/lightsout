import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { selectQueueWorker } from '#src/queue/common/utils/selectQueueWorker.ts';
import { type LifecycleSettings, TrackerStatusRole } from '#src/ticketLifecycle/index.ts';
import type { TrackerTicket } from '#src/ticketTracker/index.ts';

interface Params {
	ticket: TrackerTicket;
	lifecycle: LifecycleSettings;
	/**
	 * True when the ticket came from the parked scan, whose worktree on disk is
	 * already the evidence the queue selected it — its tracker status is In
	 * Progress by construction and no longer answers the pair rule.
	 */
	resumed: boolean;
}

/**
 * One summary per configured planning-status label the ticket carries, each
 * carrying the worker its pair selects.
 *
 * A ticket whose planning-status label was removed yields none — the caller
 * reads that as the user withdrawing the automation. A ticket carrying two
 * yields two, so the drain's ambiguity skip sees a resumed ticket exactly as it
 * sees one from the eligible list.
 */
export const toPlanningSummaries = ({ ticket, lifecycle, resumed }: Params): TicketSummary[] =>
	Object.values(PlanningStatus)
		.filter((planningStatus) => ticket.labels.includes(lifecycle.planningStatusLabels[planningStatus]))
		.map((planningStatus) => ({
			...ticket,
			planningStatus,
			worker: selectQueueWorker({
				planningStatus,
				trackerStatus: resumed ? undefined : ticket.status,
				readyStatus: lifecycle.statusNames[TrackerStatusRole.Ready],
			}),
		}));

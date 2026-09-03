import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';

interface Params {
	planningStatus: PlanningStatus;
	/**
	 * The ticket's own workflow status, or undefined when the caller has already
	 * established this ticket is the queue's work — the parked scan, whose
	 * worktree on disk is that evidence.
	 */
	trackerStatus: string | undefined;
	/** The configured name of the ready-to-implement status. */
	readyStatus: string;
}

/**
 * The worker one planning-status-and-tracker-status pair selects, or undefined
 * when the pair is not one the queue takes.
 *
 * Exactly three pairs select a worker. A `planning-ready-auto-plan` ticket at
 * any eligible status that is not the ready one is in the pre-implementation
 * waiting area, so it is planned first; `planning-complete` at the ready status
 * implements the plan published to the ticket; `planning-not-needed` at the
 * ready status builds from the ticket body. Everything else is left alone,
 * including the two shaping states, which are never automated, and
 * `planning-not-needed` in Backlog, which the queue neither selects nor moves.
 *
 * An undefined `trackerStatus` satisfies the status half of every rule, which is
 * what lets the parked scan resume a ticket sitting at In Progress. That is also
 * what makes a mid-run relabel land correctly: a queued auto-plan ticket becomes
 * `planning-complete` once its plan is published, so a park during its nested
 * implementation resumes as the plan worker — the same work it was doing.
 */
export const selectQueueWorker = ({ planningStatus, trackerStatus, readyStatus }: Params): QueueWorker | undefined => {
	// An undefined status satisfies both halves, which is what lets the parked scan
	// resume a ticket whose worktree already answered the status question.
	const atReady = trackerStatus === undefined || trackerStatus === readyStatus;
	// The ticket reached here from the eligible query, so an eligible status that
	// is not the ready one is the pre-implementation waiting area the model calls
	// Backlog.
	const inBacklog = trackerStatus !== readyStatus;
	const selected: Record<PlanningStatus, QueueWorker | undefined> = {
		[PlanningStatus.NeedsBrainstorm]: undefined,
		[PlanningStatus.NeedsPlan]: undefined,
		[PlanningStatus.ReadyAutoPlan]: inBacklog ? QueueWorker.AutoPlan : undefined,
		[PlanningStatus.Complete]: atReady ? QueueWorker.Plan : undefined,
		[PlanningStatus.NotNeeded]: atReady ? QueueWorker.Direct : undefined,
	};

	return selected[planningStatus];
};

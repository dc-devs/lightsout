/**
 * Which worker the queue runs for a ticket — named for what it selects rather
 * than for what labelled it.
 *
 * There are three because the settled eligibility rule names three different
 * things to do. `Plan` and `Direct` are not one worker: a `planning-complete`
 * ticket carries material that was shaped, graded and published, and building
 * it from the ticket body would never read that material at all.
 */
export const QueueWorker = {
	/** Build straight from the ticket body; the repo's gates are the only bar. */
	Direct: 'direct',
	/** Implement the plan already published to the ticket. */
	Plan: 'plan',
	/** Plan the ticket headlessly with the auto-plan skill, then implement the plan. */
	AutoPlan: 'auto-plan',
} as const;

export type QueueWorker = (typeof QueueWorker)[keyof typeof QueueWorker];

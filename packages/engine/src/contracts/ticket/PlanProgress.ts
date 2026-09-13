/**
 * How far one plan of a ticket has got.
 *
 * Each value is written by exactly one step: `Planning` by `ticket add-plan`
 * and by adoption, `Ready` when `plan publish` succeeds for a plan still
 * planning, `Implementing` when an implementation run starts, `Implemented`
 * when that run passes, and `Failed` when it fails or escalates. A paused run
 * leaves the plan `Implementing`.
 *
 * Being taken out of the order is NOT a progress value: an exclusion is
 * recorded beside the progress, so an excluded plan keeps the record of how far
 * its implementation got.
 */
export const PlanProgress = {
	Planning: 'planning',
	Ready: 'ready',
	Implementing: 'implementing',
	Implemented: 'implemented',
	Failed: 'failed',
} as const;

export type PlanProgress = (typeof PlanProgress)[keyof typeof PlanProgress];

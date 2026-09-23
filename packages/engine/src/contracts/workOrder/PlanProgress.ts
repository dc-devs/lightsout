/**
 * How far one plan of a ticket has got.
 *
 * Each value is written by exactly one step: `Planning` by `work-order add-plan`,
 * `Ready` when `plan publish` succeeds for a plan still planning,
 * `Implementing` when an implementation run starts, `Implemented` when that run
 * passes, and `Failed` when it fails or escalates. A paused run leaves the plan
 * `Implementing`. A plan made out of a source folder's loose files is the one
 * plan born at any of these: `work-order add-plan --from` writes how far that
 * folder's own runs and its plan deliverable say it already got.
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

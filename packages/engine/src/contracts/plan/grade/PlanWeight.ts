/**
 * How much grading machinery one plan file earns. A file that mirrors an
 * existing pattern with a handful of creates does not need the fan-out a new
 * cross-package abstraction needs, and the readers find little there anyway.
 */
export const PlanWeight = {
	/** No readers: the structural lint and the ledger check are the grade. */
	Light: 'light',
	/** The reader fan-out runs once for this file. */
	Heavy: 'heavy',
} as const;

export type PlanWeight = (typeof PlanWeight)[keyof typeof PlanWeight];

/**
 * A plan's grade. `A` is the quality bar implement assumes (a fresh-context
 * agent can implement without guessing); `BelowA` is anything short of it.
 */
export const PlanGrade = {
	A: 'A',
	BelowA: 'below-A',
} as const;

export type PlanGrade = (typeof PlanGrade)[keyof typeof PlanGrade];

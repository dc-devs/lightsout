/** The six views a plan workspace is split into, and the value each tab is held by. */
export const PlanDetailTab = {
	Plan: 'plan',
	Decisions: 'decisions',
	Facts: 'facts',
	Grade: 'grade',
	Dedup: 'dedup',
	Notes: 'notes',
} as const;

export type PlanDetailTab = (typeof PlanDetailTab)[keyof typeof PlanDetailTab];

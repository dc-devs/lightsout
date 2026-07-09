/**
 * Outcome of one draft-repair invocation. Lowercase, to match the
 * `report.status === 'error'` check in `runPlanDraft`.
 */
export const PlanFixStatus = {
	Fixed: 'fixed',
	Error: 'error',
} as const;

export type PlanFixStatus = (typeof PlanFixStatus)[keyof typeof PlanFixStatus];

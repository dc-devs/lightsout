/**
 * Outcome of a `plan draft` run. Lowercase, to match the
 * `report.status === 'error'` check in `runPlanDraft`.
 */
export const PlanDraftStatus = {
	Drafted: 'drafted',
	Error: 'error',
} as const;

export type PlanDraftStatus = (typeof PlanDraftStatus)[keyof typeof PlanDraftStatus];

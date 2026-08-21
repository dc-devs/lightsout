/**
 * Outcome of a `plan draft` run. Lowercase because these are the literal
 * strings the plan-writer agent emits in its JSON report — not the Capitalized
 * form `DecisionSource` uses to share one token with the markdown Decision Log.
 */
export const PlanDraftStatus = {
	Drafted: 'drafted',
	Error: 'error',
} as const;

export type PlanDraftStatus = (typeof PlanDraftStatus)[keyof typeof PlanDraftStatus];

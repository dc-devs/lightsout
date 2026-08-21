/**
 * Outcome of one draft-repair invocation. Lowercase because these are the
 * literal strings the plan-repairer agent emits in its JSON report — not the
 * Capitalized form `DecisionSource` uses to share one token with the markdown
 * Decision Log.
 */
export const PlanFixStatus = {
	Fixed: 'fixed',
	Error: 'error',
} as const;

export type PlanFixStatus = (typeof PlanFixStatus)[keyof typeof PlanFixStatus];

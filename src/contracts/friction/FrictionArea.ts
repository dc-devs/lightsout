export const FrictionArea = {
	/** The plan was ambiguous, stale, or underspecified. */
	Plan: 'plan',
	/** The agent's own role instructions were unclear or contradictory. */
	Prompt: 'prompt',
	/** Provided standards conflicted with each other or the codebase. */
	Standards: 'standards',
	/** Tooling, repo state, or configuration surprised the agent. */
	Environment: 'environment',
	Other: 'other',
} as const;

export type FrictionArea = (typeof FrictionArea)[keyof typeof FrictionArea];

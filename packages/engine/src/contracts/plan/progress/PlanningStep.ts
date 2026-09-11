/**
 * The five planning steps the planning record tracks, named for the `lightsout
 * plan` subcommand that does each one.
 *
 * The key order is the order the planning block draws its rows in, whatever the
 * record holds.
 */
export const PlanningStep = {
	VerifyFacts: 'verify-facts',
	Draft: 'draft',
	Dedup: 'dedup',
	Grade: 'grade',
	Publish: 'publish',
} as const;

export type PlanningStep = (typeof PlanningStep)[keyof typeof PlanningStep];

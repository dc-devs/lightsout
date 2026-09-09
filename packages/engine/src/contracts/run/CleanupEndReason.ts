/**
 * Why implementation cleanup stopped spending rounds.
 *
 * A closed set rather than free text, because a report line, a resume and a
 * test all narrow on it: a reason nobody can render is a reason nobody can act
 * on. None of them stops the run — cleanup is bounded best-effort tidying, and
 * whatever it leaves behind is recorded and handed on to normal verification.
 */
export const CleanupEndReason = {
	/** Nothing qualified as work on the first look, so no cleanup agent was ever spawned. */
	NoWork: 'no-work',
	/** No qualifying finding was left standing after a round. */
	Clean: 'clean',
	/** Two consecutive rounds left the identical qualifying work list unchanged — a stable disagreement, not something another round can settle. */
	DeclinedTwice: 'declined-twice',
	/** Every round the configured budget allows was spent. */
	BudgetExhausted: 'budget-exhausted',
	/** The cleanup agent timed out, returned no usable report, or returned one whose status was not `complete`. */
	AgentFailed: 'agent-failed',
} as const;

export type CleanupEndReason = (typeof CleanupEndReason)[keyof typeof CleanupEndReason];

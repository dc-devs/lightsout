import type { AgentOutcome } from '#src/invoke/index.ts';

/**
 * An agent outcome read as plain fields, for assertions.
 *
 * The union is the right shape for callers — it makes "no report, no reason"
 * unrepresentable — but a test usually wants to assert on one field without
 * narrowing first. This reads the arms into the flat shape an assertion wants,
 * and returns `failure: undefined` on the success arm rather than inventing one.
 */
export const outcomeFields = <Report>(outcome: AgentOutcome<Report>) => ({
	ok: outcome.ok,
	report: outcome.ok ? outcome.report : undefined,
	failure: outcome.ok ? undefined : outcome.failure,
	rateLimited: outcome.ok ? false : outcome.rateLimited,
	usage: outcome.usage,
});

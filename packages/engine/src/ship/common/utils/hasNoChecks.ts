import type { ChecksSummary } from '#src/ship/forge/index.ts';

/**
 * Whether the forge is listing no checks at all for this commit — which is not
 * the same answer as "every check passed".
 *
 * One predicate for both readers, because the two answers it feeds point in
 * opposite directions: `waitForChecks` holds an empty list back through the
 * registration grace, and `runShipAttempt` turns one into `checks-missing`
 * rather than a timeout. A field added to `ChecksSummary` and taught to one
 * copy but not the other would silently change which verdict a repository with
 * no CI gets. Readability is a separate question and stays with the caller
 * that cares about it.
 */
export const hasNoChecks = ({ summary }: { summary: ChecksSummary }): boolean =>
	summary.failing.length === 0 && summary.pending.length === 0 && summary.passing.length === 0;

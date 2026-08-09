/**
 * A stub agent's final message: a valid WorkReport as bare JSON, with
 * overrides.
 *
 * It carries an empty `findings` list too, which makes it a valid empty
 * StandardsReviewReport as well — so a stub driver that answers every
 * invocation with this one payload answers the standards reviewer honestly
 * ("nothing to report") instead of forcing a re-emit retry it will fail anyway.
 * WorkReport ignores the extra key.
 */
export const report = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({ status: 'complete', changedFiles: [], summary: 'stub', failures: [], findings: [], ...overrides });

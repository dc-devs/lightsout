/** A stub agent's final message: a valid WorkReport as bare JSON, with overrides. */
export const report = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({ status: 'complete', changedFiles: [], summary: 'stub', failures: [], ...overrides });

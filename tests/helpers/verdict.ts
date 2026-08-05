/** A stub supervisor's final message: a valid SupervisorVerdict as bare JSON, with overrides. */
export const verdict = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({ decision: 'escalate', diagnosis: 'stub diagnosis', ...overrides });

/** How one gate attempt ends. Only `Failed` is evidence about the code. */
export const GateEnding = {
	/** Exit 0. */
	Passed: 'passed',
	/** A red that is evidence about the code — a gate that failed to spawn included. */
	Failed: 'failed',
	/** The test runner died without reporting a failing test. */
	Crashed: 'crashed',
	/** Stopped by its own ceiling, `timeouts.gate-minutes`, before it returned an exit code. */
	Timeout: 'timeout',
} as const;

export type GateEnding = (typeof GateEnding)[keyof typeof GateEnding];

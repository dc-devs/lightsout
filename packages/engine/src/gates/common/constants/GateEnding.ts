/**
 * The ways one gate attempt — and so one gate — can end.
 *
 * Only `Failed` is evidence about the code. The other two reds are a gate that
 * never returned a verdict, so no fix agent may be spent on them.
 */
export const GateEnding = {
	/** Exit 0. */
	Passed: 'passed',
	/** A red that is evidence about the code — a gate that failed to spawn included. */
	Failed: 'failed',
	/** The known jest worker crash, with no failing test beside it. */
	Crashed: 'crashed',
	/** Stopped by its own ceiling, `timeouts.gate-minutes`, before it returned an exit code. */
	Timeout: 'timeout',
} as const;

export type GateEnding = (typeof GateEnding)[keyof typeof GateEnding];

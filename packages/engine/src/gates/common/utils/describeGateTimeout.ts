interface Params {
	/** The gate as the group labels it, e.g. `test` or `[api] test-e2e`. */
	label: string;
	/** The ceiling each attempt ran under, in the minutes the operator configured. */
	ceilingMinutes: number;
}

/**
 * The one sentence a gate whose every attempt ran past its ceiling is reported
 * with.
 *
 * Written once because it is the line an operator reads to tell a timeout from
 * a failure, and two spellings of it would read as two different events. Not
 * the wait for the machine — that is `describeGateCoordinationTimeout`.
 */
export const describeGateTimeout = ({ label, ceilingMinutes }: Params): string =>
	`${label} timed out: every attempt ran past the ${ceilingMinutes}-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.`;

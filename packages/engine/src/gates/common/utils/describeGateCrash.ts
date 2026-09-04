interface Params {
	/** The gate as the group labels it, e.g. `test` or `[api] test-coverage`. */
	label: string;
}

/**
 * The one sentence a gate that never returned a verdict is reported with.
 *
 * Written once because it is the line an operator reads to tell a crash from a
 * failure, and two spellings of it would read as two different events.
 */
export const describeGateCrash = ({ label }: Params): string =>
	`${label} crashed: every attempt ended in the known jest worker SIGSEGV, so this gate never returned a verdict.`;

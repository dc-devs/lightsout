/** The two outcomes every agent-backed plan runner shares: a hard failure and a parked rate limit. Both print and exit 1. */
interface PlanRunFailure {
	status: 'failed' | 'paused-rate-limit';
	error: string;
}

/**
 * Print a plan runner's failure and exit, or narrow the result to its
 * remaining variants for the caller.
 *
 * The assertion signature is what makes this extractable at all: a plain
 * function would print and exit correctly but leave the caller still holding
 * the full union, so every property access below it would stop compiling. It
 * is named for the exit rather than the check because control leaving here is
 * the important local fact in a CLI command.
 *
 * Only the shared failure pair lives here. `plan lint` has no rate-limit
 * variant and `plan verify-facts` guards an extra condition — folding those in
 * would mean a parameterised helper that reads worse than the three lines it
 * replaced.
 */
export const exitOnPlanFailure: <Result extends { status: string }>(result: Result) => asserts result is Exclude<Result, PlanRunFailure> = (result) => {
	if (result.status === 'paused-rate-limit' || result.status === 'failed') {
		console.error(`\n${(result as unknown as PlanRunFailure).error}`);
		process.exit(1);
	}
};

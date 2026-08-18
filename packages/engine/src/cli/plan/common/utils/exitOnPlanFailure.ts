import { exitCli } from '@/cli/common/utils/exitCli';

/** The two outcomes every agent-backed plan runner shares: a hard failure and a parked rate limit. Both print and exit 1. */
interface PlanRunFailure {
	status: 'failed' | 'paused-rate-limit';
	error: string;
}

/**
 * Print a plan runner's failure and exit, or hand back the result narrowed to
 * its remaining variants for the caller.
 *
 * The narrowed return type is what makes this extractable at all: a plain
 * void function would print and exit correctly but leave the caller still
 * holding the full union, so every property access below it would stop
 * compiling. It was an assertion signature until the exit had to drain the
 * stdio pipes (see exitCli) — assertions must be synchronous, so the narrowing
 * moved into the resolved value. It is named for the exit rather than the
 * check because control leaving here is the important local fact in a CLI
 * command.
 *
 * Only the shared failure pair lives here. `plan lint` has no rate-limit
 * variant and `plan verify-facts` guards an extra condition — folding those in
 * would mean a parameterised helper that reads worse than the three lines it
 * replaced.
 */
export const exitOnPlanFailure = async <Result extends { status: string }>(result: Result): Promise<Exclude<Result, PlanRunFailure>> => {
	if (result.status === 'paused-rate-limit' || result.status === 'failed') {
		console.error(`\n${(result as unknown as PlanRunFailure).error}`);
		return exitCli({ code: 1 });
	}

	return result as Exclude<Result, PlanRunFailure>;
};

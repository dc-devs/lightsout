import { exitCli } from '@/cli/common/utils/exitCli';

/** The two outcomes every agent-backed plan runner shares: a hard failure and a parked rate limit. Both print and exit 1. */
interface PlanRunFailure {
	status: 'failed' | 'paused-rate-limit';
	error: string;
}

/**
 * Whether a result is one of the variants that outlive this function.
 *
 * Written as a type predicate because TypeScript subtracts nothing from a type
 * parameter on a false branch: asking the positive question is what lets the
 * caller below return the narrowed value without asserting it.
 */
const survivesPlanFailure = <Result extends { status: string }>(result: Result): result is Exclude<Result, PlanRunFailure> =>
	result.status !== 'failed' && result.status !== 'paused-rate-limit';

/**
 * A failure's own message, or a statement of its status when it carries none.
 *
 * The signature accepts any `{ status }` shape, so a result whose failure
 * variant has no `error` is well-typed here; the fallback is what that case
 * prints instead of the word `undefined`.
 */
const planFailureMessageOf = ({ result }: { result: { status: string } }) =>
	'error' in result && typeof result.error === 'string' ? result.error : `plan run ${result.status}`;

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
	if (survivesPlanFailure(result)) {
		return result;
	}

	console.error(`\n${planFailureMessageOf({ result })}`);

	return exitCli({ code: 1 });
};

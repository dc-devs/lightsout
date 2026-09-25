interface Params<Result> {
	/** One thunk per unit of work; results come back in this order. */
	tasks: Array<() => Promise<Result>>;
	/** Steady ceiling on in-flight tasks — slots refill the moment one frees. */
	concurrency: number;
	/** Consulted before each task starts; true stops new starts. In-flight tasks always finish. */
	shouldStop?: (params: { results: Array<Result | undefined> }) => boolean;
}

/**
 * Run `tasks` through `concurrency` slots that refill the moment one frees,
 * rather than in lockstep batches: agent durations are wildly uneven, and
 * waiting for a whole batch leaves every other slot idle until its slowest
 * member returns — which on a real fan-out is most of the wall clock.
 *
 * A shared cursor is what makes the slots refill: every runner takes the next
 * unclaimed task and keeps going until the list is spent. Results are returned
 * by task index, not by completion order, so a caller can label them without
 * threading identity through the result.
 *
 * Tasks are expected to resolve to an outcome rather than throw — the plan
 * pipeline's agent call already returns a typed outcome union — and a rejection
 * propagates out of the drain.
 *
 * `shouldStop` is checked by each slot before it claims its next task, and it
 * stops only *new starts*: everything already running is awaited, so a caller
 * always sees a settled result set. Tasks never started resolve to `undefined`,
 * which is what lets a caller distinguish "checked and clean" from "never ran" —
 * the distinction the coverage statement in the grade turns on. Without it a
 * rate-limit wall would be met by launching another eighteen spawns into it.
 */
export const drainTasks = async <Result>({ tasks, concurrency, shouldStop }: Params<Result>): Promise<Array<Result | undefined>> => {
	const results: Array<Result | undefined> = tasks.map(() => undefined);
	let next = 0;

	const runSlot = async () => {
		while (next < tasks.length && shouldStop?.({ results }) !== true) {
			const index = next;
			const task = tasks[index];

			next += 1;

			if (task) {
				results[index] = await task();
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => runSlot()));

	return results;
};

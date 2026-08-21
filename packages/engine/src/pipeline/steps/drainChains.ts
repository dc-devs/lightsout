import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import type { WriterResult } from '#src/pipeline/common/types/WriterResult.ts';

interface Params {
	/** One thunk per serial chain of writer chunks. */
	chains: Array<() => Promise<WriterResult[]>>;
	/** Where every result lands, and the park flag that stops new work. */
	aggregate: { collect: (params: { result: WriterResult }) => Promise<void>; isParked: () => boolean };
	/** Fold the warm-up spawn in, once it has settled. */
	collectWarm: () => Promise<void>;
	isSettled: () => boolean;
}

/**
 * Drain the chains through `testWriterConcurrency` slots that refill the moment
 * one frees, rather than draining in lockstep: writer durations are wildly
 * uneven — a group of one small module settles in seconds while an oversized
 * component's chunk runs for minutes — so waiting for a whole batch left every
 * other slot idle until its slowest member returned, which on a real fan-out is
 * most of the wall clock.
 *
 * A shared cursor is what makes the slots refill: every runner takes the next
 * unclaimed chain and keeps going until the list is spent or the run parks.
 */
export const drainChains = async ({ chains, aggregate, collectWarm, isSettled }: Params): Promise<void> => {
	let next = 0;

	const runSlot = async (): Promise<void> => {
		while (next < chains.length && !aggregate.isParked()) {
			const chain = chains[next];

			next += 1;

			if (chain === undefined) {
				return;
			}

			const results = await chain();

			if (isSettled()) {
				await collectWarm();
			}

			for (const result of results) {
				await aggregate.collect({ result });
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(testWriterConcurrency, chains.length) }, () => runSlot()));
};

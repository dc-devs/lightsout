import type { Driver, DriverInvocation } from '#src/drivers/index.ts';

interface Params {
	/** Collector the stub pushes every invocation it is handed into. */
	invocations?: DriverInvocation[];
	/** The judgment the stub returns for every plan file it is asked about. */
	verdicts?: unknown[];
}

/** A dedup-judge stub returning a fixed verdict set (none by default), recording every invocation it is handed. */
export const createDedupJudgeDriver = ({ invocations = [], verdicts = [] }: Params = {}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: JSON.stringify({ verdicts }), exitCode: 0 };
	},
});

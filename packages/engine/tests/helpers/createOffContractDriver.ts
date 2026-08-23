import type { Driver, DriverInvocation } from '#src/drivers/index.ts';

interface Params {
	/** Prose the agent returns instead of the contract's JSON — what buys the step its one re-emit retry. */
	text: string;
	/** Collector the stub pushes every invocation it is handed into. */
	invocations?: DriverInvocation[];
}

/** A driver that exits clean but never satisfies the contract asked of it. */
export const createOffContractDriver = ({ text, invocations = [] }: Params): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text, exitCode: 0 };
	},
});

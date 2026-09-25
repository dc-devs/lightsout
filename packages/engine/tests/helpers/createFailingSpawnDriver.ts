import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';

interface Params {
	/** True for the spawns that answer off-contract — which one of a fan-out is the dead one. */
	failsWhen: (invocation: DriverInvocation) => boolean;
	/** The prose a failing spawn returns instead of the contract's JSON. */
	failureText: string;
	/** The contract-satisfying payload every other spawn returns. */
	text: string;
}

/** A driver where only the spawns `failsWhen` selects answer off-contract, so a fan-out can be given exactly one dead member. */
export const createFailingSpawnDriver = ({ failsWhen, failureText, text }: Params): Driver => ({
	name: 'stub',
	invoke: async (invocation) => ({ text: failsWhen(invocation) ? failureText : text, exitCode: 0 }),
});

import { expect } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';

interface Params {
	/** The gap set every checker in the fan-out returns. */
	gaps?: unknown[];
	/** Collector the stub pushes every invocation it is handed into. */
	invocations?: DriverInvocation[];
}

/** A gap-check stub keyed off the gap-check marker, returning a fixed gap set and recording every invocation it is handed. */
export const createGapCheckDriver = ({ gaps = [], invocations = [] }: Params = {}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		expect(invocation.prompt.includes('# Gap-check input')).toBeTruthy();

		return { text: JSON.stringify({ gaps }), exitCode: 0 };
	},
});

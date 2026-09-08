import type { Driver, DriverInvocation } from '#src/drivers/index.ts';

/**
 * A driver that records every invocation it is handed and then answers it with
 * the driver it wraps.
 *
 * A stub's own `onCall` hook sees the prompt alone, and what a spawn was granted
 * — its system prompt, its allowed commands — is on the invocation beside it.
 */
export const recordingDriver = ({ driver, invocations }: { driver: Driver; invocations: DriverInvocation[] }): Driver => ({
	name: driver.name,
	invoke: async (invocation) => {
		invocations.push(invocation);

		return driver.invoke(invocation);
	},
});

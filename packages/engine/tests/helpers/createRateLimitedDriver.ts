import type { Driver, DriverInvocation } from '#src/drivers/index.ts';

interface Params {
	/** Collector the stub pushes every invocation it is handed into. */
	invocations?: DriverInvocation[];
}

/** A driver whose every spawn comes back rate limited, recording each invocation so the count is assertable. */
export const createRateLimitedDriver = ({ invocations = [] }: Params = {}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: '', exitCode: 1, rateLimited: true };
	},
});

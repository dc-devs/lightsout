import { LinearClient } from '@linear/sdk';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';

interface Params<Result> {
	apiKey: string;
	/** The one call to make. Everything above this function stays pure. */
	call: (client: LinearClient) => Promise<Result>;
}

/**
 * The one place a Linear client is built and a call is made.
 *
 * Every other file in `tracker/` goes through it and nothing outside the folder
 * can reach it — it is deliberately absent from the barrel — so swapping Linear
 * for another tracker later is a change inside this folder alone rather than a
 * rewrite of the queue.
 *
 * A rejection, a thrown value, or a blown deadline all become a `QueueFailure`
 * value rather than an exception, so no caller in the folder needs a try/catch.
 */
export const runLinear = async <Result>({ apiKey, call }: Params<Result>): Promise<Result | QueueFailure> => {
	const trackerTimeoutMs = 60_000;
	let timer: NodeJS.Timeout | undefined;

	try {
		const deadline = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error(`the tracker did not answer within ${trackerTimeoutMs}ms`)), trackerTimeoutMs);
		});

		return await Promise.race([call(new LinearClient({ apiKey })), deadline]);
	} catch (error) {
		return { error: messageOf({ error }) };
	} finally {
		clearTimeout(timer);
	}
};

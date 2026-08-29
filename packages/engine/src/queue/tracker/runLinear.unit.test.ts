import { describe, expect, jest, test } from '@jest/globals';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

// Mocked Imports
// -------------------------
// The SDK is the one thing here that would leave the machine. Stubbing the
// client constructor lets these tests prove the key reaches it and that nothing
// this function does can throw at its caller.
const mockConstructedWith: { apiKey: string }[] = [];

jest.mock('@linear/sdk', () => ({
	LinearClient: class {
		readonly apiKey: string;

		constructor({ apiKey }: { apiKey: string }) {
			this.apiKey = apiKey;
			mockConstructedWith.push({ apiKey });
		}
	},
}));
// -------------------------

describe('runLinear', () => {
	test('builds one client from the configured key and answers whatever the call resolved with', async () => {
		mockConstructedWith.length = 0;

		const result = await runLinear({ apiKey: 'lin_key', call: () => Promise.resolve(['LO-70']) });

		expect(result).toStrictEqual(['LO-70']);
		expect(mockConstructedWith).toStrictEqual([{ apiKey: 'lin_key' }]);
	});

	test('turns a rejected call into a failure value, so no caller in the folder needs a try/catch', async () => {
		const result = await runLinear({ apiKey: 'lin_key', call: () => Promise.reject(new Error('authentication failed')) });

		expect(result).toStrictEqual({ error: 'authentication failed' });
	});

	test('reports a thrown non-error too, because throw accepts any value', async () => {
		const result = await runLinear({
			apiKey: 'lin_key',
			call: () => {
				throw 'rate limited';
			},
		});

		expect(result).toStrictEqual({ error: 'rate limited' });
	});

	test('stops waiting at its own deadline, so an unanswering tracker cannot hold a drain open forever', async () => {
		jest.useFakeTimers();

		const pending = runLinear({ apiKey: 'lin_key', call: () => new Promise(() => undefined) });

		jest.advanceTimersByTime(60_000);

		const result = await pending;

		jest.useRealTimers();

		expect(result).toStrictEqual({ error: 'the tracker did not answer within 60000ms' });
	});
});

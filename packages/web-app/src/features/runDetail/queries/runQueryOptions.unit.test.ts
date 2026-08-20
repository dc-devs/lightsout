import { describe, expect, jest, test } from '@jest/globals';
import { RunNotFoundError, type RunView } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { runQueryOptions } from '#src/features/runDetail/index.ts';
import { buildRunView } from '#tests/helpers/buildRunView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it. Under Jest the Start stub
// hands `handler()` straight back, so the real `getRunServerFn` runs and the
// fetcher is proved all the way down to the seam the app is allowed to stub.
const mockGetRun = jest.fn<(params: { runId: string }) => Promise<RunView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getRun: (params: { runId: string }) => mockGetRun(params) }),
}));
// -------------------------

interface PolledQuery {
	state: { data?: { listing: { status: RunStatus } } };
}

const runId = 'abcdef0123456789';

const setupRunQueryOptions = ({ status, rejection }: { status?: RunStatus; rejection?: Error } = {}) => {
	if (rejection === undefined) {
		mockGetRun.mockResolvedValue(buildRunView());
	} else {
		mockGetRun.mockRejectedValue(rejection);
	}

	const options = runQueryOptions({ runId });
	const query: PolledQuery = { state: { data: status === undefined ? undefined : { listing: { status } } } };
	// TanStack types these against its own generics — a Query class for the poll
	// callback, a QueryFunctionContext for the fetcher. The options object hands
	// each nothing more than what is written here, and reproducing those generics
	// in a stub would add noise rather than safety.
	const poll = options.refetchInterval as unknown as (input: PolledQuery) => number | false;
	const fetchRun = options.queryFn as unknown as () => Promise<RunView>;

	return { fetchRun, options, poll, query };
};

describe('runQueryOptions', () => {
	test('keys the cache under the run key and the id, so two runs never share a cache entry', () => {
		const { options } = setupRunQueryOptions();

		expect(options.queryKey).toStrictEqual([QueryKey.Run, runId]);
	});

	test('fetches through the run server function, which reads the repo through the reader', async () => {
		const { fetchRun } = setupRunQueryOptions();

		const view = await fetchRun();

		expect(view.listing.runId).toBe(runId);
	});

	test("turns an id nothing on disk answers to into the router's own not-found signal", async () => {
		const { fetchRun } = setupRunQueryOptions({ rejection: new RunNotFoundError('no run matching no-such-run') });

		await expect(fetchRun()).rejects.toStrictEqual({ isNotFound: true });
	});

	test('lets any other failure travel as itself', async () => {
		const { fetchRun } = setupRunQueryOptions({ rejection: new Error('the manifest is unreadable') });

		await expect(fetchRun()).rejects.toThrow('the manifest is unreadable');
	});

	test('polls every three seconds while the run is still working', () => {
		const { poll, query } = setupRunQueryOptions({ status: RunStatus.Running });

		const interval = poll(query);

		expect(interval).toBe(3_000);
	});

	test('stops polling once the run has settled', () => {
		const { poll, query } = setupRunQueryOptions({ status: RunStatus.Passed });

		const interval = poll(query);

		expect(interval).toBe(false);
	});

	test('does not poll before the run has arrived', () => {
		const { poll, query } = setupRunQueryOptions();

		const interval = poll(query);

		expect(interval).toBe(false);
	});
});

import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it. Under Jest the Start
// stub hands `handler()` straight back, so the real `listRunsServerFn` runs and
// the fetcher is proved all the way down to the seam the app is allowed to
// stub. What the transport does with that handler is the build's business.
const mockListRuns = jest.fn<() => Promise<RunListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listRuns: () => mockListRuns() }),
}));
// -------------------------

interface PolledQuery {
	state: { data?: Array<{ status: RunStatus }> };
}

const setupRunsQueryOptions = ({ statuses }: { statuses?: RunStatus[] } = {}) => {
	mockListRuns.mockResolvedValue([buildRunListing({ runId: 'abcdef0123456789' })]);

	const options = runsQueryOptions();
	const query: PolledQuery = { state: { data: statuses?.map((status) => ({ status })) } };
	// TanStack types both of these against its own generics — a Query class for
	// the poll callback, a QueryFunctionContext for the fetcher. The options
	// object hands each nothing more than what is written here, and reproducing
	// those generics in a test stub would add noise rather than safety.
	const poll = options.refetchInterval as unknown as (input: PolledQuery) => number | false;
	const fetchRuns = options.queryFn as unknown as () => Promise<RunListing[]>;

	return { fetchRuns, options, poll, query };
};

describe('runsQueryOptions', () => {
	test('keys the cache under the runs key, so every reader shares one list', () => {
		const { options } = setupRunsQueryOptions();

		expect(options.queryKey).toStrictEqual([QueryKey.Runs]);
	});

	test('fetches through the runs server function, which reads the repo through the reader', async () => {
		const { fetchRuns } = setupRunsQueryOptions();

		const runs = await fetchRuns();

		expect(runs.map((run) => run.runId)).toStrictEqual(['abcdef0123456789']);
	});

	test('polls every three seconds while a run is in flight', () => {
		const { poll, query } = setupRunsQueryOptions({ statuses: [RunStatus.Passed, RunStatus.Running] });

		const interval = poll(query);

		expect(interval).toBe(3_000);
	});

	test('stops polling once nothing is running', () => {
		const { poll, query } = setupRunsQueryOptions({ statuses: [RunStatus.Passed, RunStatus.Failed] });

		const interval = poll(query);

		expect(interval).toBe(false);
	});

	test('does not poll before any list has arrived', () => {
		const { poll, query } = setupRunsQueryOptions();

		const interval = poll(query);

		expect(interval).toBe(false);
	});
});

import { describe, expect, jest, test } from '@jest/globals';
import type { FrictionRecord } from '@lightsout/engine';
import { frictionQueryOptions } from '#src/features/friction/index.ts';
import { buildFrictionRecord } from '#tests/helpers/buildFrictionRecord.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it. Under Jest the Start stub
// hands `handler()` straight back, so the real `getFrictionServerFn` runs and
// the fetcher is proved all the way down to the seam the app is allowed to stub.
const mockGetFriction = jest.fn<() => Promise<FrictionRecord[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getFriction: mockGetFriction }),
}));
// -------------------------

const setupFrictionQueryOptions = ({ records = [buildFrictionRecord()] }: { records?: FrictionRecord[] } = {}) => {
	mockGetFriction.mockResolvedValue(records);

	const options = frictionQueryOptions();
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchFriction = options.queryFn as unknown as () => Promise<FrictionRecord[]>;

	return { fetchFriction, options, records };
};

describe('frictionQueryOptions', () => {
	// The literal rather than `QueryKey.Friction`: the key is the cache contract
	// the page and the run detail have to agree on, and comparing the constant to
	// itself would pass however it were spelled.
	test('keys the cache under the friction key alone, since one query carries the whole log', () => {
		const { options } = setupFrictionQueryOptions();

		expect(options.queryKey).toStrictEqual(['friction']);
	});

	test('fetches the log through the server function, which reads the repo through the reader', async () => {
		const { fetchFriction, records } = setupFrictionQueryOptions({
			records: [buildFrictionRecord({ detail: 'the coverage report was stale', area: 'environment' })],
		});

		const friction = await fetchFriction();

		expect(friction).toStrictEqual(records);
	});

	test('asks for the whole log rather than for one run, because the page is repo-wide', async () => {
		const { fetchFriction } = setupFrictionQueryOptions();

		await fetchFriction();

		expect(mockGetFriction).toHaveBeenCalledWith();
	});

	test('hands back the empty log a repo that has recorded nothing produces', async () => {
		const { fetchFriction } = setupFrictionQueryOptions({ records: [] });

		const friction = await fetchFriction();

		expect(friction).toStrictEqual([]);
	});

	test('is never polled, because the log grows only when a run records something', () => {
		const { options } = setupFrictionQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});

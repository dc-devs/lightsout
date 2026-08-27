import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackListing } from '@lightsout/engine';
import { packsQueryOptions } from '#src/features/packs/index.ts';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `listPacksServerFn` runs and only
// the filesystem is stood in for.
const mockListPacks = jest.fn<() => Promise<StandardsPackListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listPacks: () => mockListPacks() }),
}));
// -------------------------

const setupPacksQueryOptions = ({ packs = [buildStandardsPackListing({ name: 'acme-house-rules' })] }: { packs?: StandardsPackListing[] } = {}) => {
	mockListPacks.mockResolvedValue(packs);

	const options = packsQueryOptions();
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchPacks = options.queryFn as unknown as () => Promise<StandardsPackListing[]>;

	return { fetchPacks, options, packs };
};

describe('packsQueryOptions', () => {
	// The literal rather than `QueryKey.Packs`: the key is the cache contract two
	// modules have to agree on, and comparing the constant to itself would pass
	// however it were spelled.
	test('keys the cache under the packs key alone, since which packs load is the repo talking rather than a caller', () => {
		const { options } = setupPacksQueryOptions();

		expect(options.queryKey).toStrictEqual(['packs']);
	});

	test('fetches through the packs server function, which reads the repo through the reader', async () => {
		const { fetchPacks } = setupPacksQueryOptions();

		const packs = await fetchPacks();

		expect(packs.map((pack) => pack.name)).toStrictEqual(['acme-house-rules']);
	});

	test('is never polled, because the list changes only when someone edits the config or adds a pack', () => {
		const { options } = setupPacksQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});

import { describe, expect, jest, test } from '@jest/globals';
import { StandardsPackNotFoundError, type StandardsPackView } from '@lightsout/engine';
import { packQueryOptions } from '#src/features/packs/index.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it. Under Jest the Start stub
// hands `handler()` straight back, so the real `getPackServerFn` runs and the
// fetcher is proved all the way down to the seam the app is allowed to stub.
const mockGetPack = jest.fn<(params: { name: string }) => Promise<StandardsPackView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPack: (params: { name: string }) => mockGetPack(params) }),
}));
// -------------------------

const setupPackQueryOptions = ({ rejection }: { rejection?: Error } = {}) => {
	if (rejection === undefined) {
		mockGetPack.mockResolvedValue(buildStandardsPackView({ name: 'acme-house-rules' }));
	} else {
		mockGetPack.mockRejectedValue(rejection);
	}

	const options = packQueryOptions({ name: 'acme-house-rules' });
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchPack = options.queryFn as unknown as () => Promise<StandardsPackView>;

	return { fetchPack, options };
};

describe('packQueryOptions', () => {
	// The literals rather than `QueryKey.Pack`: the key is the cache contract two
	// modules have to agree on, and comparing the constant to itself would pass
	// however it were spelled.
	test('keys the cache under the pack key and the name, so two packs never share a cache entry', () => {
		const { options } = setupPackQueryOptions();

		expect(options.queryKey).toStrictEqual(['pack', 'acme-house-rules']);
	});

	test('fetches through the pack server function, which reads the repo through the reader', async () => {
		const { fetchPack } = setupPackQueryOptions();

		const pack = await fetchPack();

		expect(pack.name).toBe('acme-house-rules');
	});

	test('asks the reader for the name the options were built with, so one pack never answers for another', async () => {
		const { fetchPack } = setupPackQueryOptions();

		await fetchPack();

		expect(mockGetPack).toHaveBeenCalledWith({ name: 'acme-house-rules' });
	});

	test("turns a name no pack answers to into the router's own not-found signal", async () => {
		const { fetchPack } = setupPackQueryOptions({ rejection: new StandardsPackNotFoundError({ name: 'acme-house-rules' }) });

		await expect(fetchPack()).rejects.toStrictEqual({ isNotFound: true });
	});

	test('is never polled, because a pack changes only when someone edits it on disk', () => {
		const { options } = setupPackQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});

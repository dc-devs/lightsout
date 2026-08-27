import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackListing } from '@lightsout/engine';
import { listPacksServerFn } from '#src/features/packs/serverFns/listPacksServerFn.ts';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `listPacksServerFn` runs and only
// the filesystem at the far end of the reader is stood in for.
const mockListPacks = jest.fn<() => Promise<StandardsPackListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listPacks: mockListPacks }),
}));
// -------------------------

const setupListPacksServerFn = ({ packs = [buildStandardsPackListing()] }: { packs?: StandardsPackListing[] } = {}) => {
	mockListPacks.mockResolvedValue(packs);

	return { packs };
};

/** A reader that cannot answer at all — a broken pack folder rather than a repo that loads none. */
const setupUnreadableReader = () => {
	mockListPacks.mockRejectedValue(new Error('EACCES: permission denied'));
};

describe('listPacksServerFn', () => {
	test('hands back every pack the reader lists, whole and in the order it gave them', async () => {
		const { packs: listed } = setupListPacksServerFn({
			packs: [
				buildStandardsPackListing({ name: 'lightsout-defaults' }),
				buildStandardsPackListing({ name: 'acme-house-rules', isDefault: false, path: 'standards/acme' }),
			],
		});

		const packs = await listPacksServerFn();

		expect(packs).toStrictEqual(listed);
	});

	test('asks the reader for the list without narrowing it, since which packs load is the repo config talking', async () => {
		setupListPacksServerFn();

		await listPacksServerFn();

		expect(mockListPacks).toHaveBeenCalledWith();
	});

	test('answers a repo that loads no pack with an empty list rather than an error', async () => {
		setupListPacksServerFn({ packs: [] });

		const packs = await listPacksServerFn();

		expect(packs).toStrictEqual([]);
	});

	test('lets a reader that cannot answer surface, so the empty list only ever means no packs', async () => {
		setupUnreadableReader();

		await expect(listPacksServerFn()).rejects.toThrow('EACCES: permission denied');
	});
});

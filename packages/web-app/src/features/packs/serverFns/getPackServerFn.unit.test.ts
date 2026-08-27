import { describe, expect, jest, test } from '@jest/globals';
import { StandardsPackNotFoundError, type StandardsPackView } from '@lightsout/engine';
import { getPackServerFn } from '#src/features/packs/serverFns/getPackServerFn.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `getPackServerFn` runs and only
// the filesystem at the far end of the reader is stood in for.
const mockGetPack = jest.fn<(params: { name: string }) => Promise<StandardsPackView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPack: (params: { name: string }) => mockGetPack(params) }),
}));
// -------------------------

const setupGetPackServerFn = ({ rejection }: { rejection?: Error } = {}) => {
	const pack = buildStandardsPackView({ name: 'acme-house-rules', isDefault: false });

	if (rejection === undefined) {
		mockGetPack.mockResolvedValue(pack);
	} else {
		mockGetPack.mockRejectedValue(rejection);
	}

	return { pack };
};

describe('getPackServerFn', () => {
	test('hands back the pack the reader answered with, whole', async () => {
		const { pack } = setupGetPackServerFn();

		const answer = await getPackServerFn({ data: { name: 'acme-house-rules' } });

		expect(answer).toStrictEqual(pack);
	});

	test('asks the reader for the name the URL carried', async () => {
		setupGetPackServerFn();

		await getPackServerFn({ data: { name: 'acme-house-rules' } });

		expect(mockGetPack).toHaveBeenCalledWith({ name: 'acme-house-rules' });
	});

	test("turns a name no pack answers to into the router's own not-found signal, since an error class cannot cross the wire", async () => {
		setupGetPackServerFn({ rejection: new StandardsPackNotFoundError({ name: 'no-such-pack' }) });

		await expect(getPackServerFn({ data: { name: 'no-such-pack' } })).rejects.toStrictEqual({ isNotFound: true });
	});

	test('lets any other failure travel as itself, so a 404 only ever means the name was wrong', async () => {
		setupGetPackServerFn({ rejection: new Error('EACCES: permission denied') });

		await expect(getPackServerFn({ data: { name: 'acme-house-rules' } })).rejects.toThrow('EACCES: permission denied');
	});
});

import { describe, expect, jest, test } from '@jest/globals';
import { StandardsPackNotFoundError, StandardsPackRuleNotFoundError, type StandardsPackRuleView } from '@lightsout/engine';
import { getPackRuleServerFn } from '#src/features/packs/serverFns/getPackRuleServerFn.ts';
import { buildStandardsPackRuleView } from '#tests/helpers/buildStandardsPackRuleView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `getPackRuleServerFn` runs and
// only the filesystem at the far end of the reader is stood in for.
const mockGetPackRule = jest.fn<(params: { name: string; rule: string }) => Promise<StandardsPackRuleView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPackRule: (params: { name: string; rule: string }) => mockGetPackRule(params) }),
}));
// -------------------------

const setupGetPackRuleServerFn = ({ rejection }: { rejection?: Error } = {}) => {
	const rule = buildStandardsPackRuleView();

	if (rejection === undefined) {
		mockGetPackRule.mockResolvedValue(rule);
	} else {
		mockGetPackRule.mockRejectedValue(rejection);
	}

	return { rule };
};

describe('getPackRuleServerFn', () => {
	test('hands back the rule the reader answered with, its argument and its proof included', async () => {
		const { rule } = setupGetPackRuleServerFn();

		const answer = await getPackRuleServerFn({ data: { name: 'lightsout-defaults', rule: 'type-assertion' } });

		expect(answer).toStrictEqual(rule);
	});

	test('asks the reader for both halves of the address the URL carried', async () => {
		setupGetPackRuleServerFn();

		await getPackRuleServerFn({ data: { name: 'lightsout-defaults', rule: 'type-assertion' } });

		expect(mockGetPackRule).toHaveBeenCalledWith({ name: 'lightsout-defaults', rule: 'type-assertion' });
	});

	test("turns a pack name nothing answers to into the router's own not-found signal", async () => {
		setupGetPackRuleServerFn({ rejection: new StandardsPackNotFoundError({ name: 'no-such-pack' }) });

		await expect(getPackRuleServerFn({ data: { name: 'no-such-pack', rule: 'type-assertion' } })).rejects.toStrictEqual({ isNotFound: true });
	});

	test('turns a rule the pack does not carry into the same signal, since a renamed rule is a wrong address rather than a fault', async () => {
		setupGetPackRuleServerFn({ rejection: new StandardsPackRuleNotFoundError({ name: 'lightsout-defaults', rule: 'one-exported-function-per-file' }) });

		await expect(getPackRuleServerFn({ data: { name: 'lightsout-defaults', rule: 'one-exported-function-per-file' } })).rejects.toStrictEqual({
			isNotFound: true,
		});
	});

	test('lets any other failure travel as itself', async () => {
		setupGetPackRuleServerFn({ rejection: new Error('the fixture folder is unreadable') });

		await expect(getPackRuleServerFn({ data: { name: 'lightsout-defaults', rule: 'type-assertion' } })).rejects.toThrow('the fixture folder is unreadable');
	});
});

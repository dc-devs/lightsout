import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackRuleView } from '@lightsout/engine';
import { packRuleQueryOptions } from '#src/features/packs/index.ts';
import { buildStandardsPackRuleView } from '#tests/helpers/buildStandardsPackRuleView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it. Under Jest the Start stub
// hands `handler()` straight back, so the real `getPackRuleServerFn` runs and
// the fetcher is proved all the way down to the seam the app is allowed to stub.
const mockGetPackRule = jest.fn<(params: { name: string; rule: string }) => Promise<StandardsPackRuleView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPackRule: (params: { name: string; rule: string }) => mockGetPackRule(params) }),
}));
// -------------------------

const setupPackRuleQueryOptions = () => {
	mockGetPackRule.mockResolvedValue(buildStandardsPackRuleView({ id: 'object-args' }));

	const options = packRuleQueryOptions({ name: 'lightsout-defaults', rule: 'object-args' });
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchRule = options.queryFn as unknown as () => Promise<StandardsPackRuleView>;

	return { fetchRule, options };
};

describe('packRuleQueryOptions', () => {
	// The literals rather than `QueryKey.PackRule`: the key is the cache contract
	// two modules have to agree on, and comparing the constant to itself would
	// pass however it were spelled.
	test('keys the cache under the rule key, the pack and the rule, so two packs may hold the same rule id', () => {
		const { options } = setupPackRuleQueryOptions();

		expect(options.queryKey).toStrictEqual(['packRule', 'lightsout-defaults', 'object-args']);
	});

	test('fetches through the rule server function, which reads the pack through the reader', async () => {
		const { fetchRule } = setupPackRuleQueryOptions();

		const rule = await fetchRule();

		expect(rule.id).toBe('object-args');
	});

	test('asks the reader for both halves of the address the options were built with', async () => {
		const { fetchRule } = setupPackRuleQueryOptions();

		await fetchRule();

		expect(mockGetPackRule).toHaveBeenCalledWith({ name: 'lightsout-defaults', rule: 'object-args' });
	});

	test('never goes stale, so a row opened, closed and opened again asks the server nothing', () => {
		const { options } = setupPackRuleQueryOptions();

		expect(options.staleTime).toBe(Number.POSITIVE_INFINITY);
	});
});

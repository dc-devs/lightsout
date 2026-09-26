import { describe, expect, test } from '@jest/globals';
import { getDefaultPackRuleServerFn } from '#src/features/packs/internal/serverFns/getDefaultPackRuleServerFn.ts';

describe('getDefaultPackRuleServerFn', () => {
	test('answers with one shipped rule whole, its argument and its proof included', async () => {
		const rule = await getDefaultPackRuleServerFn({ data: { rule: 'folder-size' } });

		expect({ id: rule.id, hasProof: rule.fixtures.length > 0 }).toStrictEqual({ id: 'folder-size', hasProof: true });
	});

	test("turns a rule the pack does not carry into the router's own not-found signal", async () => {
		await expect(getDefaultPackRuleServerFn({ data: { rule: 'no-such-rule' } })).rejects.toStrictEqual({ isNotFound: true });
	});
});

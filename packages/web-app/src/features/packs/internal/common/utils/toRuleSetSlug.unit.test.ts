import { describe, expect, test } from '@jest/globals';
import { toRuleSetChannel } from '#src/features/packs/internal/common/utils/toRuleSetChannel.ts';
import { toRuleSetSlug } from '#src/features/packs/internal/common/utils/toRuleSetSlug.ts';

describe('toRuleSetSlug', () => {
	test('addresses the base rules as the TypeScript rules a reader knows them as', () => {
		expect(toRuleSetSlug({ channel: 'base' })).toBe('typescript');
	});

	test('addresses any other set by its own channel id', () => {
		expect(toRuleSetSlug({ channel: 'tanstack' })).toBe('tanstack');
	});

	test('reads back to the channel it came from, so an address round-trips', () => {
		expect(['base', 'react'].map((channel) => toRuleSetChannel({ ruleSet: toRuleSetSlug({ channel }) }))).toStrictEqual(['base', 'react']);
	});
});

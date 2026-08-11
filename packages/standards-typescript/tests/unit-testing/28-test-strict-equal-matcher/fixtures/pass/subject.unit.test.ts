import { expect, describe, test } from '@jest/globals';

// A test whose subject reads code as text passes that code in as data. This is
// a mention of the pairing the rule bans, not one — the rule reads what the
// file does, not what it quotes.
const sampleLine = 'expect(result).toStrictEqual(expect.any(String));';

describe('subject', () => {
	test('matches the whole result', () => {
		const result = { id: 'a', size: 2 };

		expect(result).toStrictEqual({ id: 'a', size: 2 });
	});

	test('carries its sample line untouched', () => {
		expect(sampleLine).toContain('toStrictEqual');
	});
});

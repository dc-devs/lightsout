import { expect, describe, test } from '@jest/globals';

describe('strictEqualMatcher', () => {
	test('matches part of the result', () => {
		const result = { id: 'a', size: 2 };

		expect(result).toStrictEqual(expect.objectContaining({ id: 'a' }));
	});
});

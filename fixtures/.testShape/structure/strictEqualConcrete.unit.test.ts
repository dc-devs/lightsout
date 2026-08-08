import { expect, describe, test } from '@jest/globals';

describe('strictEqualConcrete', () => {
	test('matches the whole result', () => {
		const result = { id: 'a', size: 2 };

		expect(result).toStrictEqual({ id: 'a', size: 2 });
	});
});

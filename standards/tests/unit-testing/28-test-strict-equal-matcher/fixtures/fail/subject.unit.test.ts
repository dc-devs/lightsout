import { expect, describe, test } from '@jest/globals';

describe('subject', () => {
	test('matches part of the result', () => {
		const result = { id: 'a', size: 2 };

		expect(result).toStrictEqual(expect.objectContaining({ id: 'a' }));
	});
});

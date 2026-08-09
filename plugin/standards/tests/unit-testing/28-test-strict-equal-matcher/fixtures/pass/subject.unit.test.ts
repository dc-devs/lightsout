import { expect, describe, test } from '@jest/globals';

describe('subject', () => {
	test('matches the whole result', () => {
		const result = { id: 'a', size: 2 };

		expect(result).toStrictEqual({ id: 'a', size: 2 });
	});
});

import { expect, describe, test } from '@jest/globals';

describe('nestedDescribe', () => {
	describe('the details of the thing', () => {
		test('adds two numbers', () => {
			expect(1 + 1).toBe(2);
		});
	});
});

import { expect, describe, test, beforeEach } from '@jest/globals';

describe('twoRules', () => {
	describe('the details of the thing', () => {
		beforeEach(() => {
			expect(1 + 1).toBe(2);
		});

		test('adds two numbers', () => {
			expect(2 + 2).toBe(4);
		});
	});
});

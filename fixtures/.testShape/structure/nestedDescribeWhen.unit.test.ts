import { expect, describe, test } from '@jest/globals';

describe('nestedDescribeWhen', () => {
	describe('when the value is missing', () => {
		test('falls back to zero', () => {
			expect(0).toBe(0);
		});
	});

	describe('for the numeric variant', () => {
		test('adds two numbers', () => {
			expect(1 + 1).toBe(2);
		});
	});
});

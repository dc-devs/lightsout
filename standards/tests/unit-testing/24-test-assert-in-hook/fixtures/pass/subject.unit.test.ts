import { expect, describe, test, afterEach } from '@jest/globals';

describe('subject', () => {
	afterEach(() => {
		expect(1 + 1).toBe(2);
	});

	test('adds two numbers', () => {
		expect(2 + 2).toBe(4);
	});
});

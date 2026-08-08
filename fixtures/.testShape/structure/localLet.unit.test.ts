import { expect, describe, test, beforeEach } from '@jest/globals';

let callCount = 0;

const bump = () => {
	callCount = callCount + 1;
};

describe('localLet', () => {
	beforeEach(() => {
		bump();
	});

	test('counts through the helper', () => {
		let total = callCount;

		total = total + 1;

		expect(total > 0).toBe(true);
	});
});

import { expect, describe, test } from '@jest/globals';
import { getTotal } from './index';

describe('getTotal', () => {
	test('multiplies the quantity by the unit price', () => {
		// arrange
		const quantity = 2;
		const unitPrice = 50;
		// act and assert in one breath, with the call nested in the matcher
		expect(getTotal({ quantity, unitPrice })).toBe(100);
	});
});

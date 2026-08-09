import { expect, describe, test } from '@jest/globals';
import { getTotal } from './index';

const setupOrder = ({ quantity = 2, unitPrice = 50 }: { quantity?: number; unitPrice?: number } = {}) => {
	return { quantity, unitPrice };
};

describe('getTotal', () => {
	test('multiplies the quantity by the unit price', () => {
		const { quantity, unitPrice } = setupOrder();

		const total = getTotal({ quantity, unitPrice });

		expect(total).toBe(100);
	});
});

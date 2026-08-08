import { expect, describe, test } from '@jest/globals';

const setupOrder = () => ({ order: { id: 'a' } });

const setupCustomer = () => ({ customer: { id: 'c' } });

describe('multipleSetups', () => {
	test('reads both arrangements', () => {
		const { order } = setupOrder();
		const { customer } = setupCustomer();

		expect(order.id + customer.id).toBe('ac');
	});
});

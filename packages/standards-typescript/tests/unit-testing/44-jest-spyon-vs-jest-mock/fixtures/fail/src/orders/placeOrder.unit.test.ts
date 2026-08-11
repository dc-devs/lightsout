import { expect, describe, test, jest } from '@jest/globals';
import { placeOrder } from './index';

// The repository is an object the test already holds — replacing its whole
// module hides every other method the unit may touch.
const mockSave = jest.fn<(order: { id: string }) => void>();

jest.mock('./orderRepository', () => ({
	orderRepository: { save: (order: { id: string }) => mockSave(order) },
}));

describe('placeOrder', () => {
	test('saves the order it was given', () => {
		placeOrder({ order: { id: 'a' } });

		expect(mockSave).toHaveBeenCalledWith({ id: 'a' });
	});
});

import { expect, describe, test, jest } from '@jest/globals';

const mockSaveOrder = jest.fn<(params: { id: string }) => string>();

jest.mock('@/orders/saveOrder', () => ({
	saveOrder: (params: { id: string }) => mockSaveOrder(params),
}));

describe('subject', () => {
	test('forwards the order id', () => {
		mockSaveOrder.mockReturnValue('ok');

		expect(mockSaveOrder).toHaveBeenCalledWith({ id: 'a' });
	});
});

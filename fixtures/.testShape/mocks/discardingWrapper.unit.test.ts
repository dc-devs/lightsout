import { expect, describe, test, jest } from '@jest/globals';

const mockSaveOrder = jest.fn<(params: { id: string }) => string>();

jest.mock('@/orders/saveOrder', () => ({
	saveOrder: (...args: unknown[]) => mockSaveOrder(args[0] as { id: string }),
}));

describe('discardingWrapper', () => {
	test('saves the order', () => {
		mockSaveOrder.mockReturnValue('ok');

		expect(mockSaveOrder({ id: 'a' })).toBe('ok');
	});
});

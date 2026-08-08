import { expect, describe, test, jest } from '@jest/globals';

const mockGetCurrency = jest.fn<() => string>();

const setupCurrency = () => {
	mockGetCurrency.mockReset();
	mockGetCurrency.mockReturnValue('GBP');

	return { currency: 'GBP' };
};

describe('resetInFactory', () => {
	test('reads the currency', () => {
		const { currency } = setupCurrency();

		expect(mockGetCurrency()).toBe(currency);
	});
});

import { expect, describe, test, jest } from '@jest/globals';
import { placeOrder } from './index';

const setupOrder = () => {
	const repository = { save: () => undefined };
	const saveSpy = jest.spyOn(repository, 'save');

	return { repository, saveSpy };
};

describe('placeOrder', () => {
	test('saves the order it was given', () => {
		const { repository, saveSpy } = setupOrder();

		placeOrder({ repository, order: { id: 'a' } });

		expect(saveSpy).toHaveBeenCalledWith({ id: 'a' });
	});
});

import { expect, describe, test } from '@jest/globals';
import { renderInvoice } from './index';

const setupInvoice = ({
	customer = 'Ada',
	currency = 'USD',
	amount = 100,
	discount = 0,
	taxRate = 0,
	isPaid = false,
}: {
	customer?: string;
	currency?: string;
	amount?: number;
	discount?: number;
	taxRate?: number;
	isPaid?: boolean;
} = {}) => {
	return { customer, currency, amount, discount, taxRate, isPaid };
};

describe('renderInvoice', () => {
	test('names the customer it was built for', () => {
		const invoice = setupInvoice({ customer: 'Ada' });

		const rendered = renderInvoice(invoice);

		expect(rendered).toContain('Ada');
	});
});

import { expect, describe, test } from '@jest/globals';

const setupInvoice = ({
	title = '',
	author = '',
	rows = 0,
	columns = 0,
	locale = '',
	currency = '',
}: {
	title?: string;
	author?: string;
	rows?: number;
	columns?: number;
	locale?: string;
	currency?: string;
} = {}) => ({ label: `${title}${author}${rows}${columns}${locale}${currency}` });

describe('leanFactory', () => {
	test('builds a label from the arrangement', () => {
		const { label } = setupInvoice({ title: 'q2' });

		expect(label.startsWith('q2')).toBe(true);
	});
});

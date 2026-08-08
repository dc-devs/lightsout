import { expect, describe, test } from '@jest/globals';

const setupReport = ({
	title = '',
	author = '',
	tags = ['a', 'b'],
	columns = 0,
	locale = '',
	currency = '',
	timezone = '',
}: {
	title?: string;
	author?: string;
	tags?: string[];
	columns?: number;
	locale?: string;
	currency?: string;
	timezone?: string;
} = {}) => ({ label: `${title}${author}${tags.join('')}${columns}${locale}${currency}${timezone}` });

describe('megaFactory', () => {
	test('builds a label from the arrangement', () => {
		const { label } = setupReport({ title: 'q1' });

		expect(label.startsWith('q1')).toBe(true);
	});
});

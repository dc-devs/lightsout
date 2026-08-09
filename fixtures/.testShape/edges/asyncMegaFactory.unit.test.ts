import { expect, describe, test } from '@jest/globals';

const setupReport = async ({
	title = '',
	author = '',
	tags = '',
	columns = 0,
	locale = '',
	currency = '',
	timezone = '',
}: {
	title?: string;
	author?: string;
	tags?: string;
	columns?: number;
	locale?: string;
	currency?: string;
	timezone?: string;
} = {}) => ({ label: `${title}${author}${tags}${columns}${locale}${currency}${timezone}` });

const setupNested = ({
	title = '',
	author = '',
	tags = '',
	columns = 0,
	locale = '',
	currency = '',
	options = { verbose: true },
}: {
	title?: string;
	author?: string;
	tags?: string;
	columns?: number;
	locale?: string;
	currency?: string;
	options?: { verbose: boolean };
} = {}) => ({ label: `${title}${author}${tags}${columns}${locale}${currency}${options.verbose}` });

describe('asyncMegaFactory', () => {
	test('builds a label from the async arrangement', async () => {
		const { label } = await setupReport({ title: 'q1' });

		expect(label.startsWith('q1')).toBe(true);
	});

	test('builds a label from the nested arrangement', () => {
		const { label } = setupNested({ title: 'q2' });

		expect(label.startsWith('q2')).toBe(true);
	});
});

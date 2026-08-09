import { expect, describe, test } from '@jest/globals';
import { getSiteGroupKey } from './getSiteGroupKey.ts';

/** The sites a finding names, exactly as the check reporting them hands them over. */
const setupSites = ({
	files = [{ path: 'src/invoices/formatAmount.ts' }, { path: 'src/billing/formatAmount.ts' }],
}: { files?: Array<{ path: string; startLine?: number; endLine?: number }> } = {}) => ({ files });

describe('getSiteGroupKey', () => {
	test('sorts the paths, so one pair keys the same whichever side was reported first', () => {
		const { files } = setupSites();

		const key = getSiteGroupKey({ files });

		expect(key).toBe('src/billing/formatAmount.ts|src/invoices/formatAmount.ts');
	});

	test('a file reported at several sites enters the key once, and its line spans stay out of it', () => {
		const { files } = setupSites({
			files: [
				{ path: 'src/billing/formatAmount.ts', startLine: 3, endLine: 9 },
				{ path: 'src/billing/formatAmount.ts', startLine: 40, endLine: 46 },
			],
		});

		const key = getSiteGroupKey({ files });

		expect(key).toBe('src/billing/formatAmount.ts');
	});

	test('three files all reach the key, in path order', () => {
		const { files } = setupSites({
			files: [{ path: 'src/reports/formatAmount.ts' }, { path: 'src/invoices/formatAmount.ts' }, { path: 'src/billing/formatAmount.ts' }],
		});

		const key = getSiteGroupKey({ files });

		expect(key).toBe('src/billing/formatAmount.ts|src/invoices/formatAmount.ts|src/reports/formatAmount.ts');
	});

	test('a finding naming no file at all keys to nothing', () => {
		const { files } = setupSites({ files: [] });

		const key = getSiteGroupKey({ files });

		expect(key).toBe('');
	});
});

import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** The path lists a file-list rule receives: everything in scope, and which of those are tests. */
const setupFileListInput = ({ source, tests = [] }: { source: string[]; tests?: string[] }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source,
	tests,
	files: [...source, ...tests],
	referenceFiles: [],
	dependencies: new Map(),
});

/** The input a rule that did NOT declare `file-list` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/billing/formatAmount.ts'],
	spans: [],
});

describe('name-duplicate check', () => {
	test('asks for the file list alone, since a path already carries the export name', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports one name declared in two places, naming both files', async () => {
		const input = setupFileListInput({
			source: ['src/billing/formatAmount.ts', 'src/invoices/formatAmount.ts', 'src/invoices/getInvoiceLabel.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'name-duplicate:src/billing/formatAmount.ts|src/invoices/formatAmount.ts',
				files: [{ path: 'src/billing/formatAmount.ts' }, { path: 'src/invoices/formatAmount.ts' }],
				detail: "'formatAmount' is declared in 2 places",
				guidance: 'One concept implemented twice, or a promotion candidate.',
			},
		]);
	});

	test('a name in three places is reported once, with every file it occupies', async () => {
		const input = setupFileListInput({
			source: ['src/invoices/formatAmount.ts', 'src/billing/formatAmount.ts', 'src/reports/formatAmount.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'name-duplicate:src/billing/formatAmount.ts|src/invoices/formatAmount.ts|src/reports/formatAmount.ts',
				files: [{ path: 'src/invoices/formatAmount.ts' }, { path: 'src/billing/formatAmount.ts' }, { path: 'src/reports/formatAmount.ts' }],
				detail: "'formatAmount' is declared in 3 places",
				guidance: 'One concept implemented twice, or a promotion candidate.',
			},
		]);
	});

	test('one home per name earns no finding', async () => {
		const input = setupFileListInput({ source: ['src/common/utils/formatAmount.ts', 'src/invoices/getInvoiceLabel.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('an index in every folder is the module convention, not a duplicated name', async () => {
		const input = setupFileListInput({ source: ['src/billing/index.ts', 'src/invoices/index.ts', 'src/invoices/getInvoiceLabel.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('two tests named after the subjects they cover are the convention working', async () => {
		const input = setupFileListInput({
			source: ['src/billing/getTotal.ts', 'src/invoices/getInvoiceTotal.ts'],
			tests: ['src/billing/getTotal.unit.test.ts', 'src/invoices/getTotal.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});

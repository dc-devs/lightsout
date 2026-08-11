import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('path-domain-folder-single-file check', () => {
	test('asks for the file list alone, since the count comes from the paths themselves', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a graduated domain folder holding one file', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/formatting/formatDate.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-domain-folder-single-file:src/billing/common/formatting',
				files: [{ path: 'src/billing/common/formatting' }],
				detail: "domain folder 'formatting' holds one file",
				guidance:
					'A domain folder graduates when a SECOND related function appears — until then the file belongs in `utils/`. Heuristic — judge before acting.',
			},
		]);
	});

	test('leaves alone a domain folder holding the second related function graduation is for', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/parsing/parseDate.ts', 'src/billing/common/parsing/parseTime.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([{ folder: 'utils' }, { folder: 'types' }, { folder: 'constants' }, { folder: 'services' }])(
		'never judges $folder, which is the always-built skeleton rather than a graduation',
		async ({ folder }) => {
			const input = setupFileListInput({ files: [`src/billing/common/${folder}/formatTax.ts`] });

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([]);
		},
	);

	test('counts the test beside a file as no second file, so the folder is still reported', async () => {
		const input = setupFileListInput({
			files: ['src/billing/common/validation/validateEmail.ts', 'src/billing/common/validation/validateEmail.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-domain-folder-single-file:src/billing/common/validation']);
	});

	test('leaves alone a folder whose only file is a test, since it holds no production file to move', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/validation/validateEmail.unit.test.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test("counts the folder's own files alone, so a file in a subfolder is not its second", async () => {
		const input = setupFileListInput({ files: ['src/billing/common/parsing/parseDate.ts', 'src/billing/common/parsing/deep/parseTime.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-domain-folder-single-file:src/billing/common/parsing']);
	});

	test('never judges a one-file folder that sits nowhere under a common/', async () => {
		const input = setupFileListInput({ files: ['src/billing/features/invoices/getInvoice.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports every such folder separately, in path order', async () => {
		const input = setupFileListInput({ files: ['src/pay/common/rounding/round.ts', 'src/bill/common/formatting/formatDate.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'path-domain-folder-single-file:src/bill/common/formatting',
			'path-domain-folder-single-file:src/pay/common/rounding',
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});

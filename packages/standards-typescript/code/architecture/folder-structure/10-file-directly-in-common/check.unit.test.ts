import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('file-directly-in-common check', () => {
	test('asks for the file list alone, since where a file sits is decided from its path', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a file sitting directly in a common/ folder', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/rate.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'file-directly-in-common:src/billing/common/rate.ts',
				files: [{ path: 'src/billing/common/rate.ts' }],
				detail: "'rate.ts' sits directly in src/billing/common",
				guidance:
					'Move it under the type folder for what it is — `utils/`, `types/`, `constants/`, `services/`, or a graduated domain folder. `common/` is always typed, never flat.',
			},
		]);
	});

	test('leaves alone a file filed under a type folder inside common/', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/utils/formatRate.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves alone files that sit nowhere near a common/ folder', async () => {
		const input = setupFileListInput({ files: ['src/billing/rate.ts', 'rate.ts', 'src/common-utils/rate.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ barrel: 'index.ts' },
		{ barrel: 'index.tsx' },
		{ barrel: 'index.js' },
		{ barrel: 'index.jsx' },
		{ barrel: 'index.mjs' },
		{ barrel: 'index.cjs' },
		{ barrel: 'index.mts' },
		{ barrel: 'index.cts' },
	])('leaves $barrel directly in common/ to the barrel rule, so one wrong file is one finding', async ({ barrel }) => {
		const input = setupFileListInput({ files: [`src/billing/common/${barrel}`] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a file whose name merely starts with index, since only a real barrel is excused', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/indexer.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'file-directly-in-common:src/billing/common/indexer.ts',
				files: [{ path: 'src/billing/common/indexer.ts' }],
				detail: "'indexer.ts' sits directly in src/billing/common",
				guidance:
					'Move it under the type folder for what it is — `utils/`, `types/`, `constants/`, `services/`, or a graduated domain folder. `common/` is always typed, never flat.',
			},
		]);
	});

	test('reports every flat file separately, so each one carries its own site key', async () => {
		const input = setupFileListInput({
			files: ['src/billing/common/rate.ts', 'src/billing/common/index.ts', 'src/billing/common/utils/formatRate.ts', 'src/pay/common/fee.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.siteKey)).toStrictEqual([
			'file-directly-in-common:src/billing/common/rate.ts',
			'file-directly-in-common:src/pay/common/fee.ts',
		]);
	});

	test('leaves a JavaScript-spelled barrel directly in common/ alone, since the shared name test answers for every dialect', async () => {
		const input = setupFileListInput({ files: ['src/common/index.mjs'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});

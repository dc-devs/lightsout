import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a path rule: every file in scope, no text read. */
const setupFileListInput = ({ files }: { files: string[] }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files,
	tests: [],
	files,
	referenceFiles: [],
	dependencies: new Map(),
	standardsPackages: [],
});

/** The input a rule that did NOT declare `file-list` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/billing/common/utils/index.ts'],
	spans: [],
});

describe('path-common-barrel check', () => {
	test('asks for the file list alone, since a barrel under common/ is decided from its path', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a barrel sitting in a type folder under common/', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/utils/index.ts', 'src/billing/common/utils/formatRate.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-common-barrel:src/billing/common/utils/index.ts',
				files: [{ path: 'src/billing/common/utils/index.ts' }],
				detail: 'a barrel under src/billing/common/utils',
				guidance: 'A barrel marks a boundary and `common/` is definitionally boundary-less — delete it and import the files directly.',
			},
		]);
	});

	test('reports a barrel sitting directly in a common/ folder', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-common-barrel:src/billing/common/index.ts',
				files: [{ path: 'src/billing/common/index.ts' }],
				detail: 'a barrel under src/billing/common',
				guidance: 'A barrel marks a boundary and `common/` is definitionally boundary-less — delete it and import the files directly.',
			},
		]);
	});

	test('reports a barrel however deep it sits beneath common/, naming the folder it was found in', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/utils/rates/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-common-barrel:src/billing/common/utils/rates/index.ts',
				files: [{ path: 'src/billing/common/utils/rates/index.ts' }],
				detail: 'a barrel under src/billing/common/utils/rates',
				guidance: 'A barrel marks a boundary and `common/` is definitionally boundary-less — delete it and import the files directly.',
			},
		]);
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
	])('reports $barrel too, so the rule runs at full strength whatever the source dialect', async ({ barrel }) => {
		const input = setupFileListInput({ files: [`src/billing/common/utils/${barrel}`] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: `path-common-barrel:src/billing/common/utils/${barrel}`,
				files: [{ path: `src/billing/common/utils/${barrel}` }],
				detail: 'a barrel under src/billing/common/utils',
				guidance: 'A barrel marks a boundary and `common/` is definitionally boundary-less — delete it and import the files directly.',
			},
		]);
	});

	test('leaves alone a file under common/ whose name merely starts with index', async () => {
		const input = setupFileListInput({ files: ['src/billing/common/utils/indexer.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves alone a module barrel outside common/, which is the boundary the rule wants', async () => {
		const input = setupFileListInput({ files: ['src/billing/index.ts', 'src/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves alone a barrel in a folder whose name only begins with common', async () => {
		const input = setupFileListInput({ files: ['src/common-utils/index.ts', 'src/uncommon/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves alone a barrel at the repo root, which sits in no folder at all', async () => {
		const input = setupFileListInput({ files: ['index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports every offending barrel separately, so each one carries its own site key', async () => {
		const input = setupFileListInput({
			files: ['src/billing/common/utils/index.ts', 'src/billing/index.ts', 'src/pay/common/types/index.ts', 'src/pay/common/types/Rate.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.siteKey)).toStrictEqual([
			'path-common-barrel:src/billing/common/utils/index.ts',
			'path-common-barrel:src/pay/common/types/index.ts',
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});

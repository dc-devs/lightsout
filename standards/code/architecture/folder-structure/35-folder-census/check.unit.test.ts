import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a path rule: every file in scope, plus the test files among them. */
const setupFileListInput = ({ files, tests = [] }: { files: string[]; tests?: string[] }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files,
	tests,
	files,
	referenceFiles: [],
	dependencies: new Map(),
});

/** The input a rule that did NOT declare `file-list` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/wide/a.ts'],
	spans: [],
});

describe('folder-census check', () => {
	test('asks for the file list alone, since a folder is counted from the paths in it', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a folder holding more files than the cap', async () => {
		const input = setupFileListInput({ files: ['src/wide/a.ts', 'src/wide/b.ts', 'src/wide/c.ts', 'src/wide/d.ts'] });

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'folder-census:src/wide',
				files: [{ path: 'src/wide' }],
				detail: '4 files in one flat folder (census cap ~3)',
				guidance: 'Group them by domain, or graduate the concepts hiding in the pile.',
			},
		]);
	});

	test('leaves a folder sitting exactly at the cap alone', async () => {
		const input = setupFileListInput({ files: ['src/narrow/a.ts', 'src/narrow/b.ts', 'src/narrow/c.ts'] });

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings).toStrictEqual([]);
	});

	test('counts the barrel too, since it is a line in the directory listing like any other', async () => {
		const input = setupFileListInput({ files: ['src/wide/a.ts', 'src/wide/b.ts', 'src/wide/c.ts', 'src/wide/index.ts'] });

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(['4 files in one flat folder (census cap ~3)']);
	});

	test('never counts a test beside its subject, so obeying the co-location rule cannot push a folder over', async () => {
		const input = setupFileListInput({
			files: ['src/wide/a.ts', 'src/wide/b.ts', 'src/wide/c.ts', 'src/wide/a.unit.test.ts'],
			tests: ['src/wide/a.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings).toStrictEqual([]);
	});

	test('counts each folder on its own, so files in a subfolder never roll up into the parent', async () => {
		const input = setupFileListInput({
			files: ['src/wide/a.ts', 'src/wide/b.ts', 'src/wide/c.ts', 'src/wide/d.ts', 'src/wide/deep/e.ts', 'src/wide/deep/f.ts'],
		});

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'folder-census:src/wide',
				files: [{ path: 'src/wide' }],
				detail: '4 files in one flat folder (census cap ~3)',
				guidance: 'Group them by domain, or graduate the concepts hiding in the pile.',
			},
		]);
	});

	test('reports every oversized folder separately, so each one carries its own site key', async () => {
		const input = setupFileListInput({
			files: [
				'src/wide/a.ts',
				'src/wide/b.ts',
				'src/wide/c.ts',
				'src/narrow/a.ts',
				'src/other/a.ts',
				'src/other/b.ts',
				'src/other/c.ts',
			],
		});

		const findings = await check.run({ input, settings: { cap: 2 } });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['folder-census:src/wide', 'folder-census:src/other']);
	});

	test('names the repo root as the folder when the pile sits at the top level', async () => {
		const input = setupFileListInput({ files: ['a.ts', 'b.ts', 'c.ts'] });

		const findings = await check.run({ input, settings: { cap: 2 } });

		expect(findings).toStrictEqual([
			expect.objectContaining({
				siteKey: 'folder-census:.',
				files: [{ path: '.' }],
			}),
		]);
	});

	test('restates the cap it was given, so a configured census reads back the number in force', async () => {
		const input = setupFileListInput({ files: Array.from({ length: 21 }, (_, index) => `src/wide/wide${index}.ts`) });

		const findings = await check.run({ input, settings: { cap: 20 } });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(['21 files in one flat folder (census cap ~20)']);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: { cap: 3 } });

		expect(findings).toStrictEqual([]);
	});
});

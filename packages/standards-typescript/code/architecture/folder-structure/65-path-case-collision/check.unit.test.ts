import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('path-case-collision check', () => {
	test('asks for the file list, since the verdict is in the paths alone', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a source file whose stem matches a sibling folder in another casing', async () => {
		const input = setupFileListInput({ files: ['src/contracts/Gates.ts', 'src/contracts/gates/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-case-collision:src/contracts/Gates.ts|src/contracts/gates/index.ts',
				files: [{ path: 'src/contracts/Gates.ts' }, { path: 'src/contracts/gates/index.ts' }],
				detail: "'Gates.ts', 'gates/' differ only by casing in src/contracts",
				guidance:
					'A case-insensitive filesystem resolves these to one entry, a case-sensitive one to two — rename one side so every machine sees the same tree.',
			},
		]);
	});

	test('reports two sibling files whose full names differ only by casing', async () => {
		const input = setupFileListInput({ files: ['docs/README.md', 'docs/readme.md'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.length).toBe(1);
		expect(findings[0]?.detail).toBe("'README.md', 'readme.md' differ only by casing in docs");
	});

	test('reports two sibling folders whose names differ only by casing', async () => {
		const input = setupFileListInput({ files: ['src/Plan/draft.ts', 'src/plan/grade.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.length).toBe(1);
		expect(findings[0]?.detail).toBe("'Plan/', 'plan/' differ only by casing in src");
	});

	test('names the repo root as the folder when the collision sits at the top of the tree', async () => {
		const input = setupFileListInput({ files: ['README.md', 'readme.md'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-case-collision:README.md|readme.md',
				files: [{ path: 'README.md' }, { path: 'readme.md' }],
				detail: "'README.md', 'readme.md' differ only by casing in the repo root",
				guidance:
					'A case-insensitive filesystem resolves these to one entry, a case-sensitive one to two — rename one side so every machine sees the same tree.',
			},
		]);
	});

	test('names the two casings in name order, whichever order the file list gave them', async () => {
		const input = setupFileListInput({ files: ['docs/readme.md', 'docs/README.md'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'README.md', 'readme.md' differ only by casing in docs");
	});

	test('reports each colliding name of one folder as its own job, in name order', async () => {
		const input = setupFileListInput({ files: ['src/Gates.ts', 'src/gates/index.ts', 'src/Plan/draft.ts', 'src/plan/grade.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-case-collision:src/Gates.ts|src/gates/index.ts',
				files: [{ path: 'src/Gates.ts' }, { path: 'src/gates/index.ts' }],
				detail: "'Gates.ts', 'gates/' differ only by casing in src",
				guidance:
					'A case-insensitive filesystem resolves these to one entry, a case-sensitive one to two — rename one side so every machine sees the same tree.',
			},
			{
				siteKey: 'path-case-collision:src/Plan/draft.ts|src/plan/grade.ts',
				files: [{ path: 'src/Plan/draft.ts' }, { path: 'src/plan/grade.ts' }],
				detail: "'Plan/', 'plan/' differ only by casing in src",
				guidance:
					'A case-insensitive filesystem resolves these to one entry, a case-sensitive one to two — rename one side so every machine sees the same tree.',
			},
		]);
	});

	test('leaves a same-cased file and folder pair alone — resolution is ambiguous but identical on every machine', async () => {
		const input = setupFileListInput({ files: ['src/plan.ts', 'src/plan/draft.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves matching names in different folders alone — siblinghood is the whole hazard', async () => {
		const input = setupFileListInput({ files: ['src/plan/index.ts', 'src/cli/Plan/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});

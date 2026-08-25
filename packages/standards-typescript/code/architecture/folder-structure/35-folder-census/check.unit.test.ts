import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

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
			files: ['src/wide/a.ts', 'src/wide/b.ts', 'src/wide/c.ts', 'src/narrow/a.ts', 'src/other/a.ts', 'src/other/b.ts', 'src/other/c.ts'],
		});

		const findings = await check.run({ input, settings: { cap: 2 } });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['folder-census:src/wide', 'folder-census:src/other']);
	});

	test('names the repo root as the folder when the pile sits at the top level', async () => {
		const input = setupFileListInput({ files: ['a.ts', 'b.ts', 'c.ts'] });

		const findings = await check.run({ input, settings: { cap: 2 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'folder-census:.',
				files: [{ path: '.' }],
				detail: '3 files in one flat folder (census cap ~2)',
				guidance: 'Group them by domain, or graduate the concepts hiding in the pile.',
			},
		]);
	});

	test('restates the cap it was given, so a configured census reads back the number in force', async () => {
		const input = setupFileListInput({ files: Array.from({ length: 21 }, (_, index) => `src/wide/wide${index}.ts`) });

		const findings = await check.run({ input, settings: { cap: 20 } });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(['21 files in one flat folder (census cap ~20)']);
	});

	test('never counts a router root, whose population is the number of routes the app has', async () => {
		const input = setupFileListInput({
			files: ['src/routes/a.tsx', 'src/routes/b.tsx', 'src/routes/c.tsx', 'src/routes/d.tsx'],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings).toStrictEqual([]);
	});

	test('counts a routes/ folder that is not directly under the package’s src, so a domain folder of that name is still judged', async () => {
		const input = setupFileListInput({
			files: ['src/app/routes/a.ts', 'src/app/routes/b.ts', 'src/app/routes/c.ts', 'src/app/routes/d.ts'],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(['4 files in one flat folder (census cap ~3)']);
	});

	test('counts src/routes exactly as before in a package declaring no router, so the carve-out is earned by the dependency', async () => {
		const input = setupFileListInput({ files: ['src/routes/a.tsx', 'src/routes/b.tsx', 'src/routes/c.tsx', 'src/routes/d.tsx'] });

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['folder-census:src/routes']);
	});

	test('never counts a folder beneath a router root either, since the router owns its whole subtree', async () => {
		const input = setupFileListInput({
			files: ['src/routes/dashboard/a.tsx', 'src/routes/dashboard/b.tsx', 'src/routes/dashboard/c.tsx', 'src/routes/dashboard/d.tsx'],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings).toStrictEqual([]);
	});

	test('keeps counting the folders beside a router root, so the carve-out drops those files rather than ending the census', async () => {
		const input = setupFileListInput({
			files: [
				'src/routes/a.tsx',
				'src/routes/b.tsx',
				'src/routes/c.tsx',
				'src/routes/d.tsx',
				'src/wide/a.ts',
				'src/wide/b.ts',
				'src/wide/c.ts',
				'src/wide/d.ts',
			],
			dependencies: [['.', ['@tanstack/react-router']]],
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

	test('reads each folder against its own package’s carve-out, so one workspace’s router never exempts another’s', async () => {
		const input = setupFileListInput({
			files: [
				'packages/web/src/routes/a.tsx',
				'packages/web/src/routes/b.tsx',
				'packages/web/src/routes/c.tsx',
				'packages/web/src/routes/d.tsx',
				'packages/api/src/routes/a.ts',
				'packages/api/src/routes/b.ts',
				'packages/api/src/routes/c.ts',
				'packages/api/src/routes/d.ts',
			],
			dependencies: [
				['packages/web', ['@tanstack/react-router']],
				['packages/api', ['@nestjs/core']],
			],
		});

		const findings = await check.run({ input, settings: { cap: 3 } });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['folder-census:packages/api/src/routes']);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: { cap: 3 } });

		expect(findings).toStrictEqual([]);
	});
});

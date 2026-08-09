import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a path rule: every file in scope, plus each package's declared dependencies. */
const setupFileListInput = ({
	files,
	dependencies = [],
}: {
	files: string[];
	dependencies?: Array<[string, string[]]>;
}): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files,
	tests: [],
	files,
	referenceFiles: [],
	dependencies: new Map(dependencies),
});

/** The input a rule that did NOT declare `file-list` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/only/one-off/a.ts'],
	spans: [],
});

describe('path-folder-casing check', () => {
	test('asks for the file list alone, since a folder name is read from its path', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a folder that follows neither default casing', async () => {
		const input = setupFileListInput({ files: ['src/only/one-off/a.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-folder-casing:src/only/one-off',
				files: [{ path: 'src/only/one-off' }],
				detail: "folder 'one-off' is kebab-case",
				guidance:
					"Category folders are camelCase; a folder graduated from one class or component takes that item's PascalCase name. An established convention in the directory or the package's framework doc outranks both — heuristic, judge before acting.",
			},
		]);
	});

	test.each([
		{ folder: 'one-off', style: 'kebab-case' },
		{ folder: 'snake_folder', style: 'snake_case' },
		{ folder: '2fa', style: 'none of the three casings' },
	])('names $folder as $style, so the finding says what is wrong with the name', async ({ folder, style }) => {
		const input = setupFileListInput({ files: ['src/mixed/alpha/a.ts', 'src/mixed/beta/b.ts', `src/mixed/${folder}/c.ts`] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual([`folder '${folder}' is ${style}`]);
	});

	test('leaves both defaults alone — a camelCase category folder and a PascalCase graduated one', async () => {
		const input = setupFileListInput({ files: ['src/mixed/alpha/a.ts', 'src/HttpClient/HttpClient.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('lets a convention already settled in the directory outrank the default', async () => {
		const input = setupFileListInput({ files: ['src/settled/a-one/x.ts', 'src/settled/a-two/y.ts', 'src/settled/a-three/z.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('treats half the siblings as no convention at all — a settled directory needs more than half', async () => {
		const input = setupFileListInput({ files: ['src/tie/a-one/x.ts', 'src/tie/b-two/y.ts', 'src/tie/alpha/z.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-folder-casing:src/tie/a-one', 'path-folder-casing:src/tie/b-two']);
	});

	test('never judges a folder name a tool mandates, whatever its siblings do', async () => {
		const input = setupFileListInput({
			files: ['src/feature/__mocks__/logger.ts', 'src/feature/__tests__/Thing.unit.test.ts', 'src/feature/one-off/b.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-folder-casing:src/feature/one-off']);
	});

	test('exempts the package whose framework mandates kebab-case throughout, and only that package', async () => {
		const input = setupFileListInput({
			files: ['packages/api/src/user-profile/get-profile.ts', 'src/domain/other-name/getThing.ts'],
			dependencies: [
				['.', ['zod']],
				['packages/api', ['@nestjs/core']],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-folder-casing:src/domain/other-name']);
	});

	test("exempts a route directory directly under the package's src/, and not one of the same name deeper down", async () => {
		const input = setupFileListInput({
			files: ['src/app/user-name/page.tsx', 'src/domain/app/user-name/getThing.ts'],
			dependencies: [['.', ['next']]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-folder-casing:src/domain/app/user-name']);
	});

	test("judges only paths inside a package's source tree, never the repo's own test tree", async () => {
		const input = setupFileListInput({ files: ['tests/one-off/a.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});

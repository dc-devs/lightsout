import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '#src/contracts/index.ts';
import { StandardsInputKind } from '#src/contracts/index.ts';
import { readStandardsPack } from '#src/standardsPacks/index.ts';

/** A temp standards pack holding the given pack-relative files, plus any empty folders. */
const setupPack = ({ files = {}, folders = [] }: { files?: Record<string, string>; folders?: string[] } = {}) => {
	const packPath = mkdtempSync(join(tmpdir(), 'lightsout-pack-'));

	for (const folder of folders) {
		mkdirSync(join(packPath, folder), { recursive: true });
	}

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packPath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { packPath };
};

/** The root file every valid pack carries. */
const rootFile = { 'lightsout-standards.json': '{ "name": "acme", "formatVersion": 1 }\n' };

/** One rule folder's files: its markdown plus the fixture pair every rule ships. */
const ruleFiles = ({ path, markdown }: { path: string; markdown: string }) => ({
	[`${path}/rule.md`]: markdown,
	[`${path}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
	[`${path}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
});

/**
 * The check a rule ships, written the way a pack author writes one: a `check`
 * export naming its input kind, and one finding per file it is handed.
 */
const _checkSource =
	'export const check = {\n' +
	"\tinputKind: 'file-list',\n" +
	'\trun: ({ input }) => input.files.map((path) => ({ siteKey: `loose-file:${path}`, files: [{ path }], detail: `${path} sits outside a module` })),\n' +
	'};\n';

/** The engine-built input a file-list check reads — only `files` is what the check above looks at. */
const _fileListInput = ({ files }: { files: string[] }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files,
	tests: [],
	files,
	referenceFiles: [],
	dependencies: new Map(),
	standardsPacks: [],
});

describe('readStandardsPack — the framework-owned fixtures path', () => {
	test('records the pack-level framework-owned fixtures path when the pack ships one', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
				'fixtures/framework-owned/nestjs/src/main.ts': 'export const value = 1;\n',
			},
		});

		const pkg = await readStandardsPack({ packPath });

		// found by convention, never declared — the same way a rule folder's fixtures are
		expect(pkg.frameworkOwnedFixturesPath).toBe(join(packPath, 'fixtures', 'framework-owned'));
	});

	test('leaves the framework-owned fixtures path unset for a pack that ships none', async () => {
		const { packPath } = setupPack({
			files: {
				...rootFile,
				'code/style/document.md': '# Style\n',
				...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
			},
		});

		const pkg = await readStandardsPack({ packPath });

		// recorded, never required: the absence is a note from standards-validate, not a load failure
		expect(pkg.frameworkOwnedFixturesPath).toBeUndefined();
	});
});

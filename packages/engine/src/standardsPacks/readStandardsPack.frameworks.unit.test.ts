import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readStandardsPack } from '#src/standardsPacks/index.ts';

/** A temp standards pack holding the given pack-relative files. */
const setupPack = ({ files }: { files: Record<string, string> }) => {
	const packPath = mkdtempSync(join(tmpdir(), 'lightsout-pack-'));

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

/** The minimum tree that loads: a root file, one document, one rule. */
const packFiles = {
	...rootFile,
	'code/style/document.md': '# Style\n',
	...ruleFiles({ path: 'code/style/01-functions', markdown: '---\nsummary: one export per file\n---\n\nProse.\n' }),
};

describe('readStandardsPack — the framework-facts module', () => {
	test('records the path when the pack ships one', async () => {
		const { packPath } = setupPack({
			files: {
				...packFiles,
				'common/frameworks/getFrameworkFacts.ts': 'export const getFrameworkFacts = () => ({ isFrameworkLoadedFile: () => false });\n',
			},
		});

		const pack = await readStandardsPack({ packPath });

		// found by convention, never declared — the same way a rule folder's fixtures are
		expect(pack.frameworksModulePath).toBe(join(packPath, 'common', 'frameworks', 'getFrameworkFacts.ts'));
	});

	test('leaves the path unset for a pack that ships none', async () => {
		const { packPath } = setupPack({ files: packFiles });

		const pack = await readStandardsPack({ packPath });

		// recorded, never required: the engine's mirrors answer no, which is what
		// they did before this surface existed
		expect(pack.frameworksModulePath).toBeUndefined();
	});
});

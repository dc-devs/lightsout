import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { expect, test } from '@jest/globals';

// Two properties the shipped plugin rests on that nothing else would notice
// breaking. Both fail silently rather than loudly, which is why they are tested
// here rather than left to be discovered by a user.

const repoRoot = join(__dirname, '..', '..', '..');

/** Every file under a directory, as slash-separated relative paths. */
const filesUnder = async ({ dir }: { dir: string }): Promise<string[]> => {
	const entries = await readdir(dir, { recursive: true });
	const files = await Promise.all(entries.map(async (entry) => ((await stat(join(dir, entry))).isFile() ? entry.split(sep).join('/') : undefined)));

	return files.filter((entry): entry is string => entry !== undefined);
};

test('the committed bundle can resolve a typescript from where it will run', () => {
	// The fixture half of `standards-validate` asks for a compiler by walking up
	// from the running bundle's own path. When that walk finds nothing the command
	// reports every syntax-tree rule as "not validated" — as a NOTE — and still
	// exits 0. So the authoring gate for roughly thirty rules can stop working
	// while every gate in the repo stays green.
	//
	// It resolves today because the toolchain is declared at the workspace root,
	// which is an ancestor of plugin/dist/. That is a deliberate choice and an
	// invisible one: moving typescript into the packages that use it would break
	// this with no other symptom.
	const bundle = join(repoRoot, 'plugin', 'dist', 'cli.mjs');

	expect(() => createRequire(bundle).resolve('typescript')).not.toThrow();
});

test('no shipped check imports a value through a specifier Node could not resolve', async () => {
	// A shipped standards package has no node_modules — a marketplace install
	// copies plugin/ and nothing else. Its check files load through a plain
	// `import()` under Node's type stripping, so `import type` lines vanish before
	// Node ever looks at them, while a VALUE import of the same specifier would
	// throw module-not-found at check-load time, on a user's machine.
	//
	// Every check complies today, and Biome's useImportType rule is what keeps
	// them that way. This asserts the property directly, because that rule is
	// about style everywhere else in the repo and nothing records that here it is
	// load-bearing.
	const shipped = join(repoRoot, 'plugin', 'standards');
	const offenders: string[] = [];

	for (const path of (await filesUnder({ dir: shipped })).filter((entry) => entry.endsWith('.ts'))) {
		const text = await readFile(join(shipped, path), 'utf8');
		const valueImport = /^import(?!\s+type\b)[^\n]*from\s+'(?!\.)/m;

		if (valueImport.test(text)) {
			offenders.push(path);
		}
	}

	expect(offenders).toStrictEqual([]);
});

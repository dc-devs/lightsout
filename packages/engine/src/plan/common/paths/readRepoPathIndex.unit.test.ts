import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readRepoPathIndex } from '#src/plan/common/paths/readRepoPathIndex.ts';

/** A repo carrying one of each thing the walk has to decide about: a plain source file, a dependency tree, a git store, a dot directory and a declaration file. */
const repoFiles = ['src/deep/mod.ts', 'node_modules/pkg/index.js', '.git/HEAD', '.lightsout/plans/demo/plan.md', 'packages/engine/src/markdown.d.ts'];

/** A temp repo holding one file at each of `repoFiles`. */
const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-repo-index-'));

	for (const path of repoFiles) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), 'x\n');
	}

	return cwd;
};

/** The same repo with one directory below the root sealed shut, so the walk meets a `readdir` it cannot answer. */
const setupSealedRepo = () => {
	const cwd = setupRepo();
	const sealed = join(cwd, 'src', 'deep');

	chmodSync(sealed, 0o000);

	return { cwd, sealed };
};

describe('readRepoPathIndex', () => {
	test('the dependency tree and the git store are pruned, while a dot directory stays a real anchor', async () => {
		const cwd = setupRepo();

		const index = await readRepoPathIndex({ cwd });

		// `.lightsout` and `.claude` are directories plans name — a leading dot is
		// not a reason to hide one
		expect([...index.topLevelDirs].sort()).toStrictEqual(['.lightsout', 'packages', 'src']);
	});

	test('the pool holds every file, including the ones a source-file walk deliberately omits', async () => {
		const cwd = setupRepo();

		const index = await readRepoPathIndex({ cwd });

		// a `.d.ts` declaration and a dot-directory file are real files on disk, and
		// a check that blocks a plan may not judge a name against a pool that cannot
		// hold it
		expect(index.files).toContain(join('src', 'deep', 'mod.ts'));
		expect(index.files).toContain(join('.lightsout', 'plans', 'demo', 'plan.md'));
		expect(index.files).toContain(join('packages', 'engine', 'src', 'markdown.d.ts'));
		expect(index.files.some((path) => path.includes('node_modules'))).toBe(false);
		expect(index.files.some((path) => path.includes('.git'))).toBe(false);
	});

	test('a directory below the root that cannot be read aborts the walk rather than yielding a pool missing that subtree', async () => {
		const { cwd, sealed } = setupSealedRepo();

		const index = await readRepoPathIndex({ cwd });

		chmodSync(sealed, 0o755);
		// a partial pool blocks a plan silently: the caller's guard fires only on an
		// empty pool, so a pool missing one unreadable subtree would report every
		// file under it as absent with nothing signalling that anything went wrong
		expect(index).toStrictEqual({ topLevelDirs: new Set(['.lightsout', 'packages', 'src']), files: [] });
	});

	test('a root that cannot be read yields an empty index rather than raising', async () => {
		const index = await readRepoPathIndex({ cwd: join(tmpdir(), 'lightsout-no-such-repo') });

		// an empty pool is the caller's signal that the tree could not be seen, and
		// the only failure state this walk can safely have
		expect(index.files).toStrictEqual([]);
		expect([...index.topLevelDirs]).toStrictEqual([]);
	});
});

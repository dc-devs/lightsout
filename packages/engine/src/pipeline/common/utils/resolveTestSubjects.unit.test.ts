import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolveTestSubjects } from '#src/pipeline/common/utils/resolveTestSubjects.ts';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

const setupRepo = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-subjects-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(dir, dirname(name)), { recursive: true });
		writeFileSync(join(dir, name), content);
	}

	return dir;
};

test('resolveTestSubjects: without a consumer TypeScript every target is its own subject — the per-file fallback', async () => {
	const { subjects, orphans } = await resolveTestSubjects({
		cwd: '/nowhere',
		targets: ['src/a.js', 'src/b.js'],
		universe: ['src/a.js', 'src/b.js'],
		packagesDir: 'packages',
		compiler: undefined,
	});

	expect([...subjects.entries()]).toStrictEqual([
		['src/a.js', ['src/a.js']],
		['src/b.js', ['src/b.js']],
	]);
	expect(orphans).toStrictEqual([]);
});

test('resolveTestSubjects: files outside internal/ are their own subjects; internals walk up to the public files that reach them', async () => {
	const universe = [
		'src/feature/feature.ts',
		'src/feature/internal/mid.ts',
		'src/feature/internal/helper.ts',
		'src/feature/internal/orphan.ts',
		'src/common/utils/format.ts',
		'src/loose.ts',
		'src/feature/feature.unit.test.ts',
	];
	const cwd = setupRepo({
		'src/feature/feature.ts': "import { mid } from './internal/mid';\nexport const feature = () => mid();",
		'src/feature/internal/mid.ts': "import { helper } from './helper';\nexport const mid = () => helper();",
		'src/feature/internal/helper.ts': 'export const helper = () => 1;',
		'src/feature/internal/orphan.ts': 'export const orphan = () => 2;',
		'src/common/utils/format.ts': 'export const format = () => 3;',
		'src/loose.ts': 'export const loose = () => 4;',
		// a test importing the internal must not become its subject
		'src/feature/feature.unit.test.ts': "import { helper } from './internal/helper';",
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/feature/feature.ts', 'src/feature/internal/helper.ts', 'src/feature/internal/orphan.ts', 'src/common/utils/format.ts', 'src/loose.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// outside every internal/ folder → its own subject
	expect(subjects.get('src/feature/feature.ts')).toStrictEqual(['src/feature/feature.ts']);
	// internal, reached through an internal intermediary → the public file that imports the chain
	expect(subjects.get('src/feature/internal/helper.ts')).toStrictEqual(['src/feature/feature.ts']);
	// common/ is shared placement, not privacy → its own subject
	expect(subjects.get('src/common/utils/format.ts')).toStrictEqual(['src/common/utils/format.ts']);
	expect(subjects.get('src/loose.ts')).toStrictEqual(['src/loose.ts']);
	// internal and imported by nothing public → orphan
	expect(orphans).toStrictEqual(['src/feature/internal/orphan.ts']);
	expect(subjects.has('src/feature/internal/orphan.ts')).toBe(false);
});

test('resolveTestSubjects: a file named for internal/ but not inside such a folder is its own subject', async () => {
	const universe = ['src/internal.ts'];
	const cwd = setupRepo({ 'src/internal.ts': 'export const internal = () => 1;' });

	const { subjects } = await resolveTestSubjects({ cwd, targets: ['src/internal.ts'], universe, packagesDir: 'packages', compiler: ts });

	expect(subjects.get('src/internal.ts')).toStrictEqual(['src/internal.ts']);
});

test('resolveTestSubjects: subjects never cross packages — an importer in another package cannot rescue an internal', async () => {
	const universe = ['packages/a/src/mod/pub.ts', 'packages/a/src/mod/internal/helper.ts', 'packages/b/src/user.ts'];
	const cwd = setupRepo({
		'packages/a/src/mod/pub.ts': 'export const pub = () => 1;',
		'packages/a/src/mod/internal/helper.ts': 'export const helper = () => 2;',
		// the only importer lives in another package — it must not count
		'packages/b/src/user.ts': "import { helper } from '../../a/src/mod/internal/helper';\nexport const user = () => helper();",
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['packages/a/src/mod/internal/helper.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// the walk stays inside packages/a, so nothing public reaches the internal
	expect(orphans).toStrictEqual(['packages/a/src/mod/internal/helper.ts']);
	expect(subjects.size).toBe(0);
});

test('resolveTestSubjects: an inert public importer (a package entry) is passed through, and its own importers are walked instead', async () => {
	const universe = ['src/app.ts', 'src/index.ts', 'src/mod/internal/deep.ts'];
	const cwd = setupRepo({
		'src/app.ts': "import { deep } from './index';\nexport const app = () => deep();",
		// public, but inert: it only re-exports
		'src/index.ts': "export { deep } from './mod/internal/deep';",
		'src/mod/internal/deep.ts': 'export const deep = () => 1;',
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/mod/internal/deep.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// the walk passes through the inert entry and lands on the non-inert public file that imports it
	expect(subjects.get('src/mod/internal/deep.ts')).toStrictEqual(['src/app.ts']);
	expect(orphans).toStrictEqual([]);
});

test('resolveTestSubjects: a target the universe listing never saw still anchors its own edges — a file created this run resolves like any other', async () => {
	// listSourceFiles ran before the implement step wrote fresh.ts
	const universe = ['src/mod/pub.ts'];
	const cwd = setupRepo({
		'src/mod/pub.ts': "import { fresh } from './internal/fresh';\nexport const pub = () => fresh();",
		'src/mod/internal/fresh.ts': 'export const fresh = () => 1;',
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/mod/internal/fresh.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// were the target left out of the resolution universe, pub.ts's import
	// would resolve to nothing and the new file would look orphaned
	expect(subjects.get('src/mod/internal/fresh.ts')).toStrictEqual(['src/mod/pub.ts']);
	expect(orphans).toStrictEqual([]);
});

test('resolveTestSubjects: two internals whose walks converge on one public file each name it once', async () => {
	const universe = ['src/mod/pub.ts', 'src/mod/internal/midA.ts', 'src/mod/internal/midB.ts', 'src/mod/internal/helper.ts', 'src/mod/internal/other.ts'];
	const cwd = setupRepo({
		'src/mod/pub.ts': "import { midA } from './internal/midA';\nimport { midB } from './internal/midB';\nexport const pub = () => midA() + midB();",
		// helper.ts is reached through BOTH intermediaries, so the walk meets pub.ts twice
		'src/mod/internal/midA.ts': "import { helper } from './helper';\nexport const midA = () => helper();",
		'src/mod/internal/midB.ts': "import { helper } from './helper';\nimport { other } from './other';\nexport const midB = () => helper() + other();",
		'src/mod/internal/helper.ts': 'export const helper = () => 1;',
		'src/mod/internal/other.ts': 'export const other = () => 2;',
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/mod/internal/helper.ts', 'src/mod/internal/other.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// the two converging branches collapse to one subject, not a repeat
	expect(subjects.get('src/mod/internal/helper.ts')).toStrictEqual(['src/mod/pub.ts']);
	// a second target re-judging the same public file agrees with the first
	expect(subjects.get('src/mod/internal/other.ts')).toStrictEqual(['src/mod/pub.ts']);
	expect(orphans).toStrictEqual([]);
});

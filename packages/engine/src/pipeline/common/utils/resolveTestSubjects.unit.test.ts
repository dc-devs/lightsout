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

test('resolveTestSubjects: exported, root-common, and barrel-less files are their own subjects; internals walk up to the public files that reach them', async () => {
	const universe = [
		'src/feature/index.ts',
		'src/feature/feature.ts',
		'src/feature/mid.ts',
		'src/feature/helper.ts',
		'src/feature/orphan.ts',
		'src/common/utils/format.ts',
		'src/loose.ts',
		'src/feature/feature.unit.test.ts',
	];
	const cwd = setupRepo({
		// the barrel hides mid/helper/orphan → src/feature is a module
		'src/feature/index.ts': "export { feature } from './feature';",
		'src/feature/feature.ts': "import { mid } from './mid';\nexport const feature = () => mid();",
		'src/feature/mid.ts': "import { helper } from './helper';\nexport const mid = () => helper();",
		'src/feature/helper.ts': 'export const helper = () => 1;',
		'src/feature/orphan.ts': 'export const orphan = () => 2;',
		'src/common/utils/format.ts': 'export const format = () => 3;',
		'src/loose.ts': 'export const loose = () => 4;',
		// a test importing the internal must not become its subject
		'src/feature/feature.unit.test.ts': "import { helper } from './helper';",
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/feature/feature.ts', 'src/feature/helper.ts', 'src/feature/orphan.ts', 'src/common/utils/format.ts', 'src/loose.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// exported from the ancestor barrel → its own subject
	expect(subjects.get('src/feature/feature.ts')).toStrictEqual(['src/feature/feature.ts']);
	// internal, reached through an internal intermediary → the public file that imports the chain
	expect(subjects.get('src/feature/helper.ts')).toStrictEqual(['src/feature/feature.ts']);
	// root-layer common/ → a boundary outright
	expect(subjects.get('src/common/utils/format.ts')).toStrictEqual(['src/common/utils/format.ts']);
	// no ancestor module at all → its own subject
	expect(subjects.get('src/loose.ts')).toStrictEqual(['src/loose.ts']);
	// hidden by the barrel and imported by nothing public → orphan
	expect(orphans).toStrictEqual(['src/feature/orphan.ts']);
	expect(subjects.has('src/feature/orphan.ts')).toBe(false);
});

test('resolveTestSubjects: subjects never cross packages — an importer in another package cannot rescue an internal', async () => {
	const universe = ['packages/a/src/mod/index.ts', 'packages/a/src/mod/pub.ts', 'packages/a/src/mod/helper.ts', 'packages/b/src/user.ts'];
	const cwd = setupRepo({
		// the barrel hides helper.ts → packages/a/src/mod is a module
		'packages/a/src/mod/index.ts': "export { pub } from './pub';",
		'packages/a/src/mod/pub.ts': 'export const pub = () => 1;',
		'packages/a/src/mod/helper.ts': 'export const helper = () => 2;',
		// the only importer lives in another package — it must not count
		'packages/b/src/user.ts': "import { helper } from '../../a/src/mod/helper';\nexport const user = () => helper();",
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['packages/a/src/mod/helper.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// the walk stays inside packages/a, so nothing public reaches the internal
	expect(orphans).toStrictEqual(['packages/a/src/mod/helper.ts']);
	expect(subjects.size).toBe(0);
});

test('resolveTestSubjects: an inert public importer (a barrel) is passed through, and its own importers are walked instead', async () => {
	const universe = ['src/app.ts', 'src/mod/index.ts', 'src/mod/inner/index.ts', 'src/mod/inner/deep.ts', 'src/mod/pub.ts'];
	const cwd = setupRepo({
		'src/app.ts': "import { deep } from './mod';\nexport const app = () => deep();",
		// hides pub.ts → src/mod is a module; the barrel itself is inert
		'src/mod/index.ts': "export { deep } from './inner';",
		// inner exports everything it owns → not a module of its own
		'src/mod/inner/index.ts': "export { deep } from './deep';",
		'src/mod/inner/deep.ts': 'export const deep = () => 1;',
		'src/mod/pub.ts': 'export const pub = () => 2;',
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/mod/inner/deep.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// deep.ts is internal to src/mod; the walk passes through both inert
	// barrels and lands on the non-inert public file that imports the chain
	expect(subjects.get('src/mod/inner/deep.ts')).toStrictEqual(['src/app.ts']);
	expect(orphans).toStrictEqual([]);
});

test('resolveTestSubjects: a target the universe listing never saw still anchors its own edges — a file created this run resolves like any other', async () => {
	// listSourceFiles ran before the implement step wrote fresh.ts
	const universe = ['src/mod/index.ts', 'src/mod/pub.ts'];
	const cwd = setupRepo({
		// the barrel hides fresh.ts → src/mod is a module
		'src/mod/index.ts': "export { pub } from './pub';",
		'src/mod/pub.ts': "import { fresh } from './fresh';\nexport const pub = () => fresh();",
		'src/mod/fresh.ts': 'export const fresh = () => 1;',
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/mod/fresh.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// were the target left out of the resolution universe, pub.ts's import
	// would resolve to nothing and the new file would look orphaned
	expect(subjects.get('src/mod/fresh.ts')).toStrictEqual(['src/mod/pub.ts']);
	expect(orphans).toStrictEqual([]);
});

test('resolveTestSubjects: two internals whose walks converge on one public file each name it once', async () => {
	const universe = ['src/mod/index.ts', 'src/mod/pub.ts', 'src/mod/midA.ts', 'src/mod/midB.ts', 'src/mod/helper.ts', 'src/mod/other.ts'];
	const cwd = setupRepo({
		// the barrel hides everything but pub.ts → src/mod is a module
		'src/mod/index.ts': "export { pub } from './pub';",
		'src/mod/pub.ts': "import { midA } from './midA';\nimport { midB } from './midB';\nexport const pub = () => midA() + midB();",
		// helper.ts is reached through BOTH intermediaries, so the walk meets pub.ts twice
		'src/mod/midA.ts': "import { helper } from './helper';\nexport const midA = () => helper();",
		'src/mod/midB.ts': "import { helper } from './helper';\nimport { other } from './other';\nexport const midB = () => helper() + other();",
		'src/mod/helper.ts': 'export const helper = () => 1;',
		'src/mod/other.ts': 'export const other = () => 2;',
	});

	const { subjects, orphans } = await resolveTestSubjects({
		cwd,
		targets: ['src/mod/helper.ts', 'src/mod/other.ts'],
		universe,
		packagesDir: 'packages',
		compiler: ts,
	});

	// the two converging branches collapse to one subject, not a repeat
	expect(subjects.get('src/mod/helper.ts')).toStrictEqual(['src/mod/pub.ts']);
	// a second target re-judging the same public file agrees with the first
	expect(subjects.get('src/mod/other.ts')).toStrictEqual(['src/mod/pub.ts']);
	expect(orphans).toStrictEqual([]);
});

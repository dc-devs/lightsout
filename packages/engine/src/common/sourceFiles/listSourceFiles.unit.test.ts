import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';

const setupRepo = ({ files }: { files: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-listsrc-'));

	for (const name of files) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), 'export const one = 1;\n');
	}

	return { cwd };
};

test('listSourceFiles: every JS/TS flavor is listed repo-relative and sorted, with test files included', async () => {
	const { cwd } = setupRepo({
		files: [
			'src/b/second.tsx',
			'src/a/first.ts',
			'src/a/first.unit.test.ts',
			'src/legacy.cjs',
			'src/esm.mjs',
			'src/types.mts',
			'src/old.cts',
			'src/widget.jsx',
			'src/util.js',
		],
	});

	const { files } = await listSourceFiles({ cwd });

	expect(files).toStrictEqual([
		'src/a/first.ts',
		'src/a/first.unit.test.ts',
		'src/b/second.tsx',
		'src/esm.mjs',
		'src/legacy.cjs',
		'src/old.cts',
		'src/types.mts',
		'src/util.js',
		'src/widget.jsx',
	]);
});

test('listSourceFiles: dot entries, dependency and build dirs, declaration files, and non-source extensions are skipped', async () => {
	const { cwd } = setupRepo({
		files: [
			'src/keep.ts',
			'src/types.d.ts',
			'src/data.json',
			'src/styles.css',
			'README.md',
			'.hidden/secret.ts',
			'src/.cache/tmp.ts',
			'node_modules/pkg/index.js',
			'dist/bundle.js',
			'build/out.js',
			'coverage/lcov.js',
			'out/thing.js',
		],
	});

	const { files } = await listSourceFiles({ cwd });

	expect(files).toStrictEqual(['src/keep.ts']);
});

test('listSourceFiles: the exclude list drops matching paths, with or without a trailing slash', async () => {
	const { cwd } = setupRepo({ files: ['src/keep.ts', 'src/gen/client.ts', 'packages/api/generated/schema.ts'] });

	const { files } = await listSourceFiles({ cwd, exclude: ['src/gen/', 'packages/api/generated'] });

	// a declared generated path is excluded whether or not the config spelled it
	// with a trailing slash
	expect(files).toStrictEqual(['src/keep.ts']);
});

test('listSourceFiles: a standards pack fixture is rule data, not source, and is never listed', async () => {
	const { cwd } = setupRepo({
		files: [
			'src/keep.ts',
			'standards/lightsout-standards.json',
			'standards/common/utils/readTestFiles.ts',
			'standards/code/architecture/10-dead-export/check.ts',
			'standards/code/architecture/10-dead-export/fixtures/pass/src/used.ts',
			'standards/code/architecture/10-dead-export/fixtures/fail/src/orphan.ts',
		],
	});

	const { files } = await listSourceFiles({ cwd });

	// the check and its helper are code the engine runs; the fixtures are the
	// deliberately-shaped samples it runs them against, and grading those as
	// source reports a rule's own counter-examples as the repo's faults
	expect(files).toStrictEqual(['src/keep.ts', 'standards/code/architecture/10-dead-export/check.ts', 'standards/common/utils/readTestFiles.ts']);
});

test('listSourceFiles: a fixtures folder outside any standards pack is ordinary source', async () => {
	const { cwd } = setupRepo({ files: ['src/keep.ts', 'tests/fixtures/buildUser.ts'] });

	const { files } = await listSourceFiles({ cwd });

	// nothing here declares a pack, so `fixtures` is just a folder name
	expect(files).toStrictEqual(['src/keep.ts', 'tests/fixtures/buildUser.ts']);
});

test('listSourceFiles: walking from inside a fixture side still lists it, which is how a check is validated', async () => {
	const { cwd } = setupRepo({ files: ['standards/lightsout-standards.json', 'standards/code/architecture/10-dead-export/fixtures/fail/src/orphan.ts'] });

	const { files } = await listSourceFiles({ cwd: join(cwd, 'standards/code/architecture/10-dead-export/fixtures/fail') });

	// `standards-validate` runs each check against a fixture side as if that
	// folder were a whole repo — the pruning must not reach inside it
	expect(files).toStrictEqual(['src/orphan.ts']);
});

test('listSourceFiles: the standards pack roots the walk passed are reported with the files', async () => {
	const { cwd } = setupRepo({
		files: [
			'src/keep.ts',
			'standards/lightsout-standards.json',
			'standards/code/architecture/10-dead-export/check.ts',
			'vendor/acme-standards/lightsout-standards.json',
			'vendor/acme-standards/code/style/10-naming/check.ts',
		],
	});

	const { standardsPacks } = await listSourceFiles({ cwd });

	// every root, repo-relative — a consumer may hold several packages, and each
	// one names its own document sets
	expect(standardsPacks).toStrictEqual(['standards', 'vendor/acme-standards']);
});

test('listSourceFiles: a pack root inside another is not reported twice', async () => {
	const { cwd } = setupRepo({ files: ['standards/lightsout-standards.json', 'standards/nested/lightsout-standards.json', 'standards/nested/check.ts'] });

	const { standardsPacks } = await listSourceFiles({ cwd });

	// the outer root already covers everything beneath it
	expect(standardsPacks).toStrictEqual(['standards']);
});

test('listSourceFiles: a repo with no standards pack reports none', async () => {
	const { cwd } = setupRepo({ files: ['src/keep.ts'] });

	const { standardsPacks } = await listSourceFiles({ cwd });

	expect(standardsPacks).toStrictEqual([]);
});

test('listSourceFiles: an unreadable directory yields no files rather than throwing', async () => {
	const { cwd } = setupRepo({ files: [] });

	const { files } = await listSourceFiles({ cwd: join(cwd, 'not-there') });

	expect(files).toStrictEqual([]);
});

test('listSourceFiles: a build-output name inside a src folder is source — position is what marks output, not the name', async () => {
	const { cwd } = setupRepo({ files: ['src/coverage/runRounds.ts', 'src/dist/emit.ts', 'coverage/lcov.js', 'dist/bundle.js'] });

	const { files } = await listSourceFiles({ cwd });

	// a build tool writes beside `src`, never inside it — skipping these names
	// everywhere once hid a whole pipeline from every standards rule, silently
	expect(files).toStrictEqual(['src/coverage/runRounds.ts', 'src/dist/emit.ts']);
});

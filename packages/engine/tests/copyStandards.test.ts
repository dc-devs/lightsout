import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@jest/globals';
import { getRejectionError } from '@tests/helpers/getRejectionError';

// The build step that produces the shipped standards package, run as the real
// subprocess `pnpm bundle` runs. What it leaves out is a contract: the engine
// loads a package without fixtures or unit tests, and the pre-push hook and CI
// both rebuild into a throwaway directory to prove the committed copy matches.

const repoRoot = join(__dirname, '..', '..', '..');
const run = promisify(execFile);

/** Every file under a directory, as repo-style relative paths. */
const filesUnder = async ({ dir }: { dir: string }): Promise<string[]> => {
	const entries = await readdir(dir, { recursive: true });
	const found: string[] = [];

	for (const entry of entries) {
		const info = await stat(join(dir, entry));

		if (info.isFile()) {
			found.push(entry.split(sep).join('/'));
		}
	}

	return found.sort();
};

const buildInto = async () => {
	const out = join(await mkdtemp(join(tmpdir(), 'lightsout-standards-')), 'standards');

	await run('node', [join(repoRoot, 'scripts', 'copyStandards.mjs'), '--out', out], { cwd: repoRoot });

	return out;
};

test('copyStandards --out builds somewhere else and leaves the committed package untouched', async () => {
	const before = await filesUnder({ dir: join(repoRoot, 'plugin', 'standards') });
	const out = await buildInto();
	const after = await filesUnder({ dir: join(repoRoot, 'plugin', 'standards') });

	// the hook's whole premise: measuring must not repair
	expect(after).toStrictEqual(before);
	expect((await filesUnder({ dir: out })).length).toBeGreaterThan(0);
});

test('the shipped package carries every rule but none of the evidence that only proves it', async () => {
	const out = await buildInto();
	const shipped = await filesUnder({ dir: out });
	const authored = await filesUnder({ dir: join(repoRoot, 'packages', 'standards-typescript') });

	// fixtures and co-located tests are what a package is validated BY, not what
	// it runs on, got: ${JSON.stringify(shipped.filter((path) => path.includes('fixtures/')))}
	expect(shipped.some((path) => path.includes('fixtures/'))).toBe(false);
	expect(shipped.some((path) => path.endsWith('.unit.test.ts'))).toBe(false);

	// nor does it carry what only lets the package be DEVELOPED, nor anything a
	// tool wrote there. Both matter for the same reason and one of them bites
	// harder: node_modules and coverage/ appear only on a machine where someone
	// installed or ran something, so a build from a clean checkout is correct
	// while the same build on a working laptop silently gains hundreds of files —
	// and the shipped-artifact check cannot see it, because it compares a fresh
	// build against the copy and both would carry it.
	const generated = ['node_modules/', 'coverage/'];

	expect(shipped.filter((path) => generated.some((dir) => path.startsWith(dir)))).toStrictEqual([]);
	expect(shipped).not.toContain('tsconfig.json');
	expect(shipped).not.toContain('README.md');

	// everything else survives the copy byte for byte, plus one manifest written
	// rather than copied — the shipped package declares its own module format
	// because a marketplace install has none above it to inherit
	const carried = authored.filter(
		(path) =>
			!path.includes('fixtures/') &&
			!path.endsWith('.unit.test.ts') &&
			!generated.some((dir) => path.startsWith(dir)) &&
			!['package.json', 'tsconfig.json', 'tsconfig.jest.json', 'jest.config.cjs', 'README.md'].includes(path),
	);

	expect(shipped).toStrictEqual([...carried, 'package.json'].sort());
	expect(JSON.parse(await readFile(join(out, 'package.json'), 'utf8'))).toStrictEqual({ type: 'module' });
});

test('copyStandards refuses an --out with no directory after it rather than building over the shipped package', async () => {
	const failure = await getRejectionError({ promise: run('node', [join(repoRoot, 'scripts', 'copyStandards.mjs'), '--out'], { cwd: repoRoot }) });

	expect((failure as Error & { stderr: string }).stderr).toMatch(/--out needs a directory/);
});

test('the committed package matches what the script builds today', async () => {
	const out = await buildInto();

	// the same comparison CI makes, so a stale plugin/standards fails here first
	expect(await filesUnder({ dir: out })).toStrictEqual(await filesUnder({ dir: join(repoRoot, 'plugin', 'standards') }));
	expect(relative(repoRoot, out).startsWith('..')).toBe(true);
});

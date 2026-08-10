import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from '@jest/globals';

// The gate that decides whether plugin/ can ship, exercised against real git
// history. The pre-push hook and CI both run this one script, so what it
// answers here is what blocks a push and what blocks a merge.
//
// Each case works in a throwaway clone. Mutating this repo to make the check
// fail would leave the damage behind whenever a test threw before restoring.

const repoRoot = join(__dirname, '..');
const manifestPath = 'plugin/.claude-plugin/plugin.json';
const clones: string[] = [];

const run = ({ cwd, command, args }: { cwd: string; command: string; args: string[] }) =>
	execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const commitAll = ({ cwd, message }: { cwd: string; message: string }) => {
	run({ cwd, command: 'git', args: ['add', '-A'] });
	run({ cwd, command: 'git', args: ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message] });
};

/**
 * A clone of this repo with its own history, sharing node_modules by symlink —
 * the check builds the engine, which needs esbuild.
 *
 * `scripts/` is copied from the working tree over what the clone checked out,
 * so these tests exercise the scripts as they stand rather than as they were
 * last committed. Everything else stays at the cloned commit, which is what
 * gives the version comparison a real base to work against.
 *
 * The engine is rebuilt and committed on main before branching. esbuild writes
 * each bundled module's path into its output, and this clone reaches its
 * dependencies through a symlink, so those paths are longer here than in a
 * normal checkout. Rebuilding once makes the clone self-consistent, so a test
 * measures the change it made rather than that difference.
 */
const setupClone = async () => {
	const dir = join(await mkdtemp(join(tmpdir(), 'lightsout-shipped-')), 'repo');

	clones.push(dir);
	run({ cwd: repoRoot, command: 'git', args: ['clone', '--quiet', '--no-hardlinks', '--shared', repoRoot, dir] });
	await cp(join(repoRoot, 'scripts'), join(dir, 'scripts'), { recursive: true });
	await symlink(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
	run({ cwd: dir, command: 'node', args: [join(dir, 'scripts', 'buildEngine.mjs')] });

	// A local clone checks out whatever branch this repo is on, so `main` is not
	// guaranteed to exist here. It is named explicitly because it is what the
	// version check compares against.
	run({ cwd: dir, command: 'git', args: ['checkout', '-q', '-B', 'main'] });
	commitAll({ cwd: dir, message: 'baseline' });
	run({ cwd: dir, command: 'git', args: ['checkout', '-q', '-b', 'feature'] });

	return dir;
};

/** The check's own verdict: its exit code, and everything it printed. */
const checkShipped = ({ cwd, base }: { cwd: string; base: string }) => {
	try {
		return { ok: true, output: run({ cwd, command: 'node', args: [join(cwd, 'scripts', 'checkShipped.mjs'), '--base', base] }) };
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string };

		return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
	}
};

const setVersion = async ({ cwd, version }: { cwd: string; version: string }) => {
	const manifest = JSON.parse(await readFile(join(cwd, manifestPath), 'utf8'));

	await writeFile(join(cwd, manifestPath), `${JSON.stringify({ ...manifest, version }, null, '\t')}\n`);
};

afterAll(async () => {
	await Promise.all(clones.map((dir) => rm(join(dir, '..'), { recursive: true, force: true })));
});

test('a clean tree with nothing shipped-facing changed passes, and says the version was not checked', async () => {
	const cwd = await setupClone();
	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(true);
	expect(output).toMatch(/nothing under plugin\/ changed/);
});

test('an engine bundle that no longer matches src/ fails', async () => {
	const cwd = await setupClone();

	await writeFile(join(cwd, 'src/cli/index.ts'), `${await readFile(join(cwd, 'src/cli/index.ts'), 'utf8')}\nconsole.log('drift');\n`);

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/plugin\/dist\/cli\.mjs does not match src\//);
});

test('a standards package that no longer matches standards/ fails, naming the file that differs', async () => {
	const cwd = await setupClone();
	const rule = 'standards/code/architecture/architecture-decisions/05-modules-and-the-graduation-rule/rule.md';

	await writeFile(join(cwd, rule), `${await readFile(join(cwd, rule), 'utf8')}\n\nDrift.\n`);

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/plugin\/standards\/ does not match standards\/ — .*rule\.md differs/);
});

test('a rule folder that was never copied into the shipped package is caught, though no file differs', async () => {
	const cwd = await setupClone();

	await rm(join(cwd, 'plugin/standards/common/utils/collapseCasing.ts'));
	commitAll({ cwd, message: 'drop a shipped file' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/is missing from the shipped copy/);
});

test('changing plugin/ without bumping the version fails, and says which version it saw', async () => {
	const cwd = await setupClone();

	await writeFile(join(cwd, 'plugin/dist/cli.mjs'), `${await readFile(join(cwd, 'plugin/dist/cli.mjs'), 'utf8')}\n// hand edit\n`);
	commitAll({ cwd, message: 'change what ships' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	// the version half fires even while the bundle half is also complaining
	expect(output).toMatch(/plugin\.json is 0\.2\.4 against a base of 0\.2\.4/);
});

test('changing plugin/ with a bumped version passes the version half', async () => {
	const cwd = await setupClone();

	await setVersion({ cwd, version: '0.3.0' });
	commitAll({ cwd, message: 'bump' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(true);
	expect(output).toMatch(/version 0\.2\.4 -> 0\.3\.0/);
});

test('a version that moved backwards fails as loudly as one that never moved', async () => {
	const cwd = await setupClone();

	await setVersion({ cwd, version: '0.1.9' });
	commitAll({ cwd, message: 'downgrade' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/plugin\.json is 0\.1\.9 against a base of 0\.2\.4/);
});

test('a two-digit segment compares as a number, so 0.2.10 is newer than 0.2.9', async () => {
	const cwd = await setupClone();

	await setVersion({ cwd, version: '0.2.9' });
	commitAll({ cwd, message: 'baseline' });
	run({ cwd, command: 'git', args: ['checkout', '-q', '-b', 'later'] });
	await setVersion({ cwd, version: '0.2.10' });
	commitAll({ cwd, message: 'bump past nine' });

	const { ok, output } = checkShipped({ cwd, base: 'feature' });

	expect(ok).toBe(true);
	expect(output).toMatch(/version 0\.2\.9 -> 0\.2\.10/);
});

test('an unknown base ref skips the version question rather than guessing', async () => {
	const cwd = await setupClone();
	const { ok, output } = checkShipped({ cwd, base: 'origin/no-such-branch' });

	expect(ok).toBe(true);
	expect(output).toMatch(/no origin\/no-such-branch to compare against/);
});

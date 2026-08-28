import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from '@jest/globals';

// The gate that decides whether plugin/ can ship, exercised against real git
// history. The pre-push hook and CI both run this one script, so what it
// answers here is what blocks a push and what blocks a merge.
//
// Each case works in a throwaway clone. Mutating this repo to make the check
// fail would leave the damage behind whenever a test threw before restoring.

const repoRoot = join(__dirname, '..', '..', '..');
const manifestPath = 'plugin/.claude-plugin/plugin.json';
const addOnManifestPath = 'plugin-linear/.claude-plugin/plugin.json';
const clones: string[] = [];

const run = ({ cwd, command, args }: { cwd: string; command: string; args: string[] }) =>
	execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const commitAll = ({ cwd, message }: { cwd: string; message: string }) => {
	run({ cwd, command: 'git', args: ['add', '-A'] });
	run({ cwd, command: 'git', args: ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message] });
};

/**
 * A clone of this repo with its own history, sharing node_modules by symlink —
 * the check builds the engine, which needs esbuild and the engine's own
 * dependencies.
 *
 * Every node_modules is linked, not just the root one. This is a workspace, and
 * the package manager installs nothing at the root that a package declared for
 * itself, so a clone with only the root link cannot resolve `zod` and the build
 * fails on the first import. The clone's package list is the authority for which
 * links to make, because a package added on the branch but not yet committed has
 * no folder in the clone to link into.
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

	for (const entry of await readdir(join(dir, 'packages'), { withFileTypes: true })) {
		const installed = join(repoRoot, 'packages', entry.name, 'node_modules');

		if (entry.isDirectory() && existsSync(installed)) {
			await symlink(installed, join(dir, 'packages', entry.name, 'node_modules'), 'dir');
		}
	}

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

/**
 * The version a clone carries. Read rather than written down: these tests are
 * about the comparison, not about any particular number, and spelling one out
 * here means every release turns them red for no reason.
 *
 * Read from the clone rather than from this working tree, because a clone
 * carries the committed version — which is the number the check actually
 * compares. Reading the working tree would turn these red for the whole time a
 * version bump sits uncommitted.
 */
const getVersion = ({ cwd, manifest = manifestPath }: { cwd: string; manifest?: string }) =>
	JSON.parse(readFileSync(join(cwd, manifest), 'utf8')).version as string;

/** Unambiguously newer and older than anything this repo will ship. */
const newer = '99.0.0';
const older = '0.0.1';

const setVersion = async ({ cwd, version, manifest = manifestPath }: { cwd: string; version: string; manifest?: string }) => {
	const parsed = JSON.parse(await readFile(join(cwd, manifest), 'utf8'));

	await writeFile(join(cwd, manifest), `${JSON.stringify({ ...parsed, version }, null, '\t')}\n`);
};

/**
 * A clone whose main branch carries the add-on plugin, so the version
 * comparison has a real base for the second shipped directory. Written into
 * the clone rather than assumed from the checkout, so these tests hold
 * whether or not the working tree's add-on files are committed yet.
 */
const setupCloneWithAddOn = async () => {
	const cwd = await setupClone();

	run({ cwd, command: 'git', args: ['checkout', '-q', 'main'] });
	await mkdir(join(cwd, 'plugin-linear', '.claude-plugin'), { recursive: true });
	await mkdir(join(cwd, 'plugin-linear', 'skills', 'linear-ticket'), { recursive: true });
	await writeFile(join(cwd, addOnManifestPath), `${JSON.stringify({ name: 'lightsout-linear', version: '0.1.0', description: 't' }, null, '\t')}\n`);
	await writeFile(join(cwd, 'plugin-linear', 'skills', 'linear-ticket', 'SKILL.md'), '---\nname: linear-ticket\n---\n');
	commitAll({ cwd, message: 'add-on baseline' });
	run({ cwd, command: 'git', args: ['checkout', '-q', '-b', 'addon-feature'] });

	return cwd;
};

afterAll(async () => {
	await Promise.all(clones.map((dir) => rm(join(dir, '..'), { recursive: true, force: true })));
});

test('a clean tree with nothing shipped-facing changed passes, and says the version was not checked', async () => {
	const cwd = await setupClone();
	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(true);
	expect(output).toMatch(/nothing under plugin\/ changed/);
	expect(output).toMatch(/nothing under plugin-linear\/ changed|plugin-linear\/.* does not exist at the base/);
});

test('changing the add-on plugin without bumping its version fails, naming its manifest', async () => {
	const cwd = await setupCloneWithAddOn();

	await writeFile(join(cwd, 'plugin-linear', 'skills', 'linear-ticket', 'SKILL.md'), '---\nname: linear-ticket\n---\n\nDrift.\n');
	commitAll({ cwd, message: 'change the add-on' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toContain(`${addOnManifestPath} is 0.1.0 against a base of 0.1.0`);
});

test('changing the add-on plugin with a bumped version passes, reporting both directories', async () => {
	const cwd = await setupCloneWithAddOn();

	await writeFile(join(cwd, 'plugin-linear', 'skills', 'linear-ticket', 'SKILL.md'), '---\nname: linear-ticket\n---\n\nDrift.\n');
	await setVersion({ cwd, version: newer, manifest: addOnManifestPath });
	commitAll({ cwd, message: 'change the add-on and bump' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(true);
	expect(output).toMatch(/nothing under plugin\/ changed/);
	expect(output).toContain(`plugin-linear/ version 0.1.0 -> ${newer}`);
});

test('an engine bundle that no longer matches src/ fails', async () => {
	const cwd = await setupClone();

	await writeFile(join(cwd, 'packages/engine/src/main.ts'), `${await readFile(join(cwd, 'packages/engine/src/main.ts'), 'utf8')}\nconsole.log('drift');\n`);

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/plugin\/dist\/cli\.mjs does not match packages\/engine\/src\//);
});

test('a standards package that no longer matches its authored source fails, naming the file that differs', async () => {
	const cwd = await setupClone();
	const rule = 'packages/standards-typescript/code/architecture/architecture-decisions/05-modules-and-the-graduation-rule/rule.md';

	await writeFile(join(cwd, rule), `${await readFile(join(cwd, rule), 'utf8')}\n\nDrift.\n`);

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/plugin\/standards\/ does not match packages\/standards-typescript\/ — .*rule\.md differs/);
});

/**
 * Any one file the shipped copy holds. Which file is incidental to the claim
 * under test, and naming one pins this to a folder layout that a burn-down
 * moves — as one did, after which the deletion threw on a path that was no
 * longer there and the failure sat behind a cached task result.
 */
const findShippedFile = async ({ cwd }: { cwd: string }) => {
	const root = join(cwd, 'plugin/standards');
	const entry = (await readdir(root, { recursive: true, withFileTypes: true })).find((candidate) => candidate.isFile() && candidate.name.endsWith('.ts'));

	if (entry === undefined) {
		throw new Error(`no shipped .ts file under ${root} to delete`);
	}

	return join(entry.parentPath, entry.name);
};

test('a rule folder that was never copied into the shipped package is caught, though no file differs', async () => {
	const cwd = await setupClone();

	await rm(await findShippedFile({ cwd }));
	commitAll({ cwd, message: 'drop a shipped file' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/is missing from the shipped copy/);
});

test('changing plugin/ without bumping the version fails, and says which version it saw', async () => {
	const cwd = await setupClone();
	const currentVersion = getVersion({ cwd });

	await writeFile(join(cwd, 'plugin/dist/cli.mjs'), `${await readFile(join(cwd, 'plugin/dist/cli.mjs'), 'utf8')}\n// hand edit\n`);
	commitAll({ cwd, message: 'change what ships' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	// the version half fires even while the bundle half is also complaining
	expect(output).toContain(`plugin.json is ${currentVersion} against a base of ${currentVersion}`);
});

test('an uncommitted change under plugin/ demands the bump, before the commit exists', async () => {
	const cwd = await setupClone();
	const currentVersion = getVersion({ cwd });

	// Left unstaged on purpose: this is `pnpm bundle` having just rewritten the
	// shipped bundle, which is when the question matters and when a check
	// reading committed state answers "nothing changed".
	await writeFile(join(cwd, 'plugin/dist/cli.mjs'), `${await readFile(join(cwd, 'plugin/dist/cli.mjs'), 'utf8')}\n// hand edit\n`);

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toContain(`plugin.json is ${currentVersion} against a base of ${currentVersion}`);
	// the old failure was a pass that said this
	expect(output).not.toMatch(/nothing under plugin\/ changed/);
});

test('changing plugin/ with a bumped version passes the version half', async () => {
	const cwd = await setupClone();
	const currentVersion = getVersion({ cwd });

	await setVersion({ cwd, version: newer });
	commitAll({ cwd, message: 'bump' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(true);
	expect(output).toContain(`version ${currentVersion} -> ${newer}`);
});

test('a version that moved backwards fails as loudly as one that never moved', async () => {
	const cwd = await setupClone();
	const currentVersion = getVersion({ cwd });

	await setVersion({ cwd, version: older });
	commitAll({ cwd, message: 'downgrade' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toContain(`plugin.json is ${older} against a base of ${currentVersion}`);
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

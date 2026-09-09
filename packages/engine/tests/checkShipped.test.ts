import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import { commitAll } from '#tests/helpers/commitAll.ts';
import { mergeWithoutCommitting } from '#tests/helpers/mergeWithoutCommitting.ts';
import { runInRepo } from '#tests/helpers/runInRepo.ts';
import { setupShippedClone } from '#tests/helpers/setupShippedClone.ts';
import { shippedManifestPaths } from '#tests/helpers/shippedManifestPaths.ts';

// The gate that decides whether plugin/ can ship, exercised against real git
// history. The pre-push hook and CI both run this one script, so what it
// answers here is what blocks a push and what blocks a merge.
//
// Every case works in a clone. Mutating this repo to make the check fail would
// leave the damage behind whenever a test threw before restoring.
//
// The clone the cases share is built once by `setupShippedClone` and reset
// between them; the budget below is generous because the first case pays for
// that whole setup, and the engine bundle is the slowest part of it.
jest.setTimeout(120_000);

const repoRoot = join(__dirname, '..', '..', '..');
const { claude: manifestPath, codex: codexManifestPath, addOnClaude: addOnManifestPath, addOnCodex: addOnCodexManifestPath } = shippedManifestPaths;

/** The check's own verdict: its exit code, and everything it printed. */
const checkShipped = ({ cwd, base }: { cwd: string; base: string }) => {
	try {
		return { ok: true, output: runInRepo({ cwd, command: 'node', args: [join(cwd, 'scripts', 'checkShipped.mjs'), '--base', base] }) };
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

const setManifestVersion = async ({ cwd, version, manifest }: { cwd: string; version: string; manifest: string }) => {
	const parsed = JSON.parse(await readFile(join(cwd, manifest), 'utf8'));

	await writeFile(join(cwd, manifest), `${JSON.stringify({ ...parsed, version }, null, '\t')}\n`);
};

const setVersion = async ({ cwd, version, manifest = manifestPath }: { cwd: string; version: string; manifest?: string }) => {
	const counterpart = manifest === manifestPath ? codexManifestPath : addOnCodexManifestPath;

	await Promise.all([manifest, counterpart].map(async (manifestPathToUpdate) => setManifestVersion({ cwd, version, manifest: manifestPathToUpdate })));
};

/**
 * A clone whose main branch carries the add-on plugin, so the version
 * comparison has a real base for the second shipped directory. Written into
 * the clone rather than assumed from the checkout, so these tests hold
 * whether or not the working tree's add-on files are committed yet.
 */
const setupCloneWithAddOn = async () => {
	const cwd = await setupShippedClone();

	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', 'main'] });
	await mkdir(join(cwd, 'plugin-linear', '.claude-plugin'), { recursive: true });
	await mkdir(join(cwd, 'plugin-linear', '.codex-plugin'), { recursive: true });
	await mkdir(join(cwd, 'plugin-linear', 'skills', 'linear-ticket'), { recursive: true });

	if (!existsSync(join(cwd, addOnCodexManifestPath))) {
		await cp(join(repoRoot, addOnCodexManifestPath), join(cwd, addOnCodexManifestPath));
	}

	if (!existsSync(join(cwd, addOnManifestPath))) {
		await writeFile(join(cwd, addOnManifestPath), `${JSON.stringify({ name: 'lightsout-linear', version: '0.1.0', description: 't' }, null, '\t')}\n`);
	}

	await setVersion({ cwd, version: '0.1.0', manifest: addOnManifestPath });
	await writeFile(join(cwd, 'plugin-linear', 'skills', 'linear-ticket', 'SKILL.md'), '---\nname: linear-ticket\n---\n');
	commitAll({ cwd, message: 'add-on baseline' });
	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', '-B', 'addon-feature'] });

	return cwd;
};

test('a clean tree with nothing shipped-facing changed passes, and says the version was not checked', async () => {
	const cwd = await setupShippedClone();
	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(true);
	expect(output).toMatch(/nothing under plugin\/ changed/);
	expect(output).toMatch(/nothing under plugin-linear\/ changed|plugin-linear\/.* does not exist at the base/);
});

test('host manifests with different versions fail even when both versions are newer', async () => {
	const cwd = await setupShippedClone();

	await setManifestVersion({ cwd, version: newer, manifest: codexManifestPath });
	commitAll({ cwd, message: 'drift the Codex manifest version' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toContain('plugin/ host manifests disagree');
	expect(output).toContain(`${codexManifestPath}=${newer}`);
});

test('changing the add-on plugin without bumping its version fails, naming its manifest', async () => {
	const cwd = await setupCloneWithAddOn();

	await writeFile(join(cwd, 'plugin-linear', 'skills', 'linear-ticket', 'SKILL.md'), '---\nname: linear-ticket\n---\n\nDrift.\n');
	commitAll({ cwd, message: 'change the add-on' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toContain('plugin-linear/ changed, which is what users install, but its host manifests are 0.1.0 against a base of 0.1.0');
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
	const cwd = await setupShippedClone();

	await writeFile(join(cwd, 'packages/engine/src/main.ts'), `${await readFile(join(cwd, 'packages/engine/src/main.ts'), 'utf8')}\nconsole.log('drift');\n`);

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/plugin\/dist\/cli\.mjs does not match packages\/engine\/src\//);
});

test('a standards package that no longer matches its authored source fails, naming the file that differs', async () => {
	const cwd = await setupShippedClone();
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
	const cwd = await setupShippedClone();

	await rm(await findShippedFile({ cwd }));
	commitAll({ cwd, message: 'drop a shipped file' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toMatch(/is missing from the shipped copy/);
});

test('changing plugin/ without bumping the version fails, and says which version it saw', async () => {
	const cwd = await setupShippedClone();
	const currentVersion = getVersion({ cwd });

	await writeFile(join(cwd, 'plugin/dist/cli.mjs'), `${await readFile(join(cwd, 'plugin/dist/cli.mjs'), 'utf8')}\n// hand edit\n`);
	commitAll({ cwd, message: 'change what ships' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	// the version half fires even while the bundle half is also complaining
	expect(output).toContain(`host manifests are ${currentVersion} against a base of ${currentVersion}`);
});

test('an uncommitted change under plugin/ demands the bump, before the commit exists', async () => {
	const cwd = await setupShippedClone();
	const currentVersion = getVersion({ cwd });

	// Left unstaged on purpose: this is `pnpm bundle` having just rewritten the
	// shipped bundle, which is when the question matters and when a check
	// reading committed state answers "nothing changed".
	await writeFile(join(cwd, 'plugin/dist/cli.mjs'), `${await readFile(join(cwd, 'plugin/dist/cli.mjs'), 'utf8')}\n// hand edit\n`);

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toContain(`host manifests are ${currentVersion} against a base of ${currentVersion}`);
	// the old failure was a pass that said this
	expect(output).not.toMatch(/nothing under plugin\/ changed/);
});

test('changing plugin/ with a bumped version passes the version half', async () => {
	const cwd = await setupShippedClone();
	const currentVersion = getVersion({ cwd });

	await setVersion({ cwd, version: newer });
	commitAll({ cwd, message: 'bump' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(true);
	expect(output).toContain(`version ${currentVersion} -> ${newer}`);
});

test('a version that moved backwards fails as loudly as one that never moved', async () => {
	const cwd = await setupShippedClone();
	const currentVersion = getVersion({ cwd });

	await setVersion({ cwd, version: older });
	commitAll({ cwd, message: 'downgrade' });

	const { ok, output } = checkShipped({ cwd, base: 'main' });

	expect(ok).toBe(false);
	expect(output).toContain(`host manifests are ${older} against a base of ${currentVersion}`);
});

test('a two-digit segment compares as a number, so 0.2.10 is newer than 0.2.9', async () => {
	const cwd = await setupShippedClone();

	await setVersion({ cwd, version: '0.2.9' });
	commitAll({ cwd, message: 'baseline' });
	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', '-b', 'later'] });
	await setVersion({ cwd, version: '0.2.10' });
	commitAll({ cwd, message: 'bump past nine' });

	const { ok, output } = checkShipped({ cwd, base: 'feature' });

	expect(ok).toBe(true);
	expect(output).toMatch(/version 0\.2\.9 -> 0\.2\.10/);
});

test('an unknown base ref skips the version question rather than guessing', async () => {
	const cwd = await setupShippedClone();
	const { ok, output } = checkShipped({ cwd, base: 'origin/no-such-branch' });

	expect(ok).toBe(true);
	expect(output).toMatch(/no origin\/no-such-branch to compare against/);
});

/**
 * The check run with a base commit pinned through the environment, the way ship
 * hands it the exact commit it fetched and merged.
 *
 * `--base` is still passed, so a run that ignored the pinned commit would answer
 * from the merge base and the assertions would catch it.
 */
const checkShippedWithPinnedBase = ({ cwd, base, baseCommit }: { cwd: string; base: string; baseCommit: string }) => {
	try {
		return {
			ok: true,
			output: execFileSync('node', [join(cwd, 'scripts', 'checkShipped.mjs'), '--base', base], {
				cwd,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				env: { ...process.env, LIGHTSOUT_SHIP_BASE_COMMIT: baseCommit },
			}),
		};
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string };

		return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
	}
};

test('checks the supplied base directly during an open merge', async () => {
	const cwd = await setupShippedClone();
	const startingVersion = getVersion({ cwd });
	const shippedSkill = join(cwd, 'plugin', 'skills', 'implement', 'SKILL.md');

	// The candidate: a change to what a marketplace install copies, committed on
	// the feature branch while the base was still where it started.
	await writeFile(shippedSkill, `${await readFile(shippedSkill, 'utf8')}\n\nDrift.\n`);
	commitAll({ cwd, message: 'change what ships' });

	const candidateHead = runInRepo({ cwd, command: 'git', args: ['rev-parse', 'HEAD'] }).trim();

	// The base moves on and publishes a version of its own. This commit is the
	// one ship fetches and pins.
	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', 'main'] });
	await setVersion({ cwd, version: newer });
	commitAll({ cwd, message: `publish ${newer}` });

	const baseCommit = runInRepo({ cwd, command: 'git', args: ['rev-parse', 'HEAD'] }).trim();

	// The merge ship opens before it commits anything: HEAD stays at the
	// candidate, which predates the pinned base, while the tree already carries
	// the published version. The merge base of the two branches is still the
	// starting commit, so only the pinned commit can see the collision.
	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', 'feature'] });
	mergeWithoutCommitting({ cwd, commit: baseCommit });

	const pinned = checkShippedWithPinnedBase({ cwd, base: 'main', baseCommit });
	const invalidBase = checkShippedWithPinnedBase({ cwd, base: 'main', baseCommit: 'not-a-commit' });
	const manual = checkShipped({ cwd, base: 'main' });

	expect(pinned.ok).toBe(false);
	expect(pinned.output).toContain(`host manifests are ${newer} against a base of ${newer}`);
	expect(invalidBase.ok).toBe(false);
	expect(invalidBase.output).not.toMatch(/shipped plugins are current/);
	expect(manual.ok).toBe(true);
	expect(manual.output).toContain(`plugin/ version ${startingVersion} -> ${newer}`);
	// The premise the pinned answer rests on, and the check's own restraint: HEAD
	// never left the candidate commit, and the merge is still open and uncommitted.
	expect(runInRepo({ cwd, command: 'git', args: ['rev-parse', 'HEAD'] }).trim()).toBe(candidateHead);
	expect(existsSync(join(cwd, '.git', 'MERGE_HEAD'))).toBe(true);
});

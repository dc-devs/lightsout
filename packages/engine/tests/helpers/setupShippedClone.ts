import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll } from '@jest/globals';
import { commitAll } from '#tests/helpers/commitAll.ts';
import { runInRepo } from '#tests/helpers/runInRepo.ts';
import { shippedManifestPaths } from '#tests/helpers/shippedManifestPaths.ts';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const clones: string[] = [];

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
const buildBaseClone = async () => {
	const dir = join(await mkdtemp(join(tmpdir(), 'lightsout-shipped-')), 'repo');

	clones.push(dir);
	runInRepo({ cwd: repoRoot, command: 'git', args: ['clone', '--quiet', '--no-hardlinks', '--shared', repoRoot, dir] });
	await cp(join(repoRoot, 'scripts'), join(dir, 'scripts'), { recursive: true });

	for (const { claude, codex } of [
		{ claude: shippedManifestPaths.claude, codex: shippedManifestPaths.codex },
		{ claude: shippedManifestPaths.addOnClaude, codex: shippedManifestPaths.addOnCodex },
	]) {
		if (!existsSync(join(dir, claude))) {
			continue;
		}

		await mkdir(dirname(join(dir, codex)), { recursive: true });
		const codexManifest = JSON.parse(await readFile(join(repoRoot, codex), 'utf8'));
		const cloneVersion = JSON.parse(await readFile(join(dir, claude), 'utf8')).version;

		await writeFile(join(dir, codex), `${JSON.stringify({ ...codexManifest, version: cloneVersion }, null, '\t')}\n`);
	}

	await symlink(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');

	for (const entry of await readdir(join(dir, 'packages'), { withFileTypes: true })) {
		const installed = join(repoRoot, 'packages', entry.name, 'node_modules');

		if (entry.isDirectory() && existsSync(installed)) {
			await symlink(installed, join(dir, 'packages', entry.name, 'node_modules'), 'dir');
		}
	}

	runInRepo({ cwd: dir, command: 'node', args: [join(dir, 'scripts', 'buildEngine.mjs')] });

	// A local clone checks out whatever branch this repo is on, so `main` is not
	// guaranteed to exist here. It is named explicitly because it is what the
	// version check compares against.
	runInRepo({ cwd: dir, command: 'git', args: ['checkout', '-q', '-B', 'main'] });
	commitAll({ cwd: dir, message: 'baseline' });

	// The sha rather than the branch name: a case that commits on `main` — the
	// add-on setup does — moves the branch, and the next case has to be able to
	// put it back.
	return { dir, baseline: runInRepo({ cwd: dir, command: 'git', args: ['rev-parse', 'HEAD'] }).trim() };
};

/** The one clone, built on first use. Every case after the first reuses it. */
let baseClone: Awaited<ReturnType<typeof buildBaseClone>> | undefined;

afterAll(async () => {
	await Promise.all(clones.map((dir) => rm(join(dir, '..'), { recursive: true, force: true })));
});

/**
 * A clone standing exactly where the baseline left it, on a fresh `feature`
 * branch — what every case starts from.
 *
 * One clone, reset between cases, rather than one clone each. Cloning the repo,
 * linking every package's node_modules and bundling the engine is around 26s of
 * identical work, and only what a case does AFTER that setup differs. Resetting
 * to the baseline commit and clearing untracked files puts the tree back in well
 * under a second, and Jest runs a file's tests one at a time, so no case can see
 * another's edits.
 *
 * `git clean` runs without `-x`, so the node_modules symlinks the setup made
 * survive; they are ignored, and re-linking them per case is most of what this
 * helper exists to avoid.
 */
export const setupShippedClone = async (): Promise<string> => {
	baseClone ??= await buildBaseClone();

	const { dir, baseline } = baseClone;

	runInRepo({ cwd: dir, command: 'git', args: ['checkout', '-q', '--force', 'main'] });
	runInRepo({ cwd: dir, command: 'git', args: ['reset', '--hard', '--quiet', baseline] });
	runInRepo({ cwd: dir, command: 'git', args: ['clean', '-qfd'] });
	runInRepo({ cwd: dir, command: 'git', args: ['checkout', '-q', '-B', 'feature'] });

	return dir;
};

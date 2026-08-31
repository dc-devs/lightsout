import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEngine } from './buildEngine.mjs';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Are the shipped plugin directories shippable?
 *
 * A marketplace install copies the plugin directories and nothing else, so
 * merging to main is what reaches users. These things have to hold, and this
 * is the only definition of them: the pre-push hook runs it for a fast local
 * answer, and CI runs the same file as the authority. Written twice, the two
 * would agree today and drift by the spring, and the one you trust would be
 * whichever you read last.
 *
 *   1. `plugin/dist/cli.mjs` is what `src/` currently builds to.
 *   2. `plugin/standards/` is what the authored default package currently
 *      builds to.
 *   3. Each host manifest for a shipped directory carries the same version.
 *   4. If anything under a shipped directory moved, that shared version is
 *      newer — users cannot tell two builds apart when both call themselves
 *      0.2.4.
 *
 * The bundle and standards comparisons are the base plugin's alone, because it
 * is the only directory shipping build output; the version question is asked
 * of every shipped directory.
 *
 * Both build halves rebuild through the same functions `pnpm bundle` uses,
 * into a throwaway directory. Nothing is written into the working tree: a
 * check that repairs what it measures reports success and leaves the fix
 * uncommitted.
 *
 * The version question reads the working tree, so an uncommitted rebuild of
 * plugin/dist/cli.mjs demands its bump before the commit rather than after.
 *
 * `--base <ref>` picks what the version is compared against (default
 * `origin/main`). A missing ref, or a base that already contains this commit,
 * skips the version question rather than inventing an answer — that is the
 * push to main itself, where there is nothing to bump against.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The directories a marketplace install copies, with every host manifest that names the same build. */
const shippedDirectories = [
	{
		dir: 'plugin',
		primaryManifestPath: join('plugin', '.claude-plugin', 'plugin.json'),
		manifestPaths: [join('plugin', '.claude-plugin', 'plugin.json'), join('plugin', '.codex-plugin', 'plugin.json')],
	},
	{
		dir: 'plugin-linear',
		primaryManifestPath: join('plugin-linear', '.claude-plugin', 'plugin.json'),
		manifestPaths: [join('plugin-linear', '.claude-plugin', 'plugin.json'), join('plugin-linear', '.codex-plugin', 'plugin.json')],
	},
];

/** Every file under a directory, as sorted slash-separated relative paths. */
const filesUnder = ({ dir }) =>
	readdirSync(dir, { recursive: true })
		.filter((entry) => statSync(join(dir, entry)).isFile())
		.map((entry) => entry.split(sep).join('/'))
		.sort();

/** The first way two directory trees differ, or undefined when they match. */
const firstDifference = ({ built, shipped }) => {
	const builtFiles = filesUnder({ dir: built });
	const shippedFiles = filesUnder({ dir: shipped });
	const missing = builtFiles.find((path) => !shippedFiles.includes(path));

	if (missing !== undefined) {
		return `${missing} is missing from the shipped copy`;
	}

	const extra = shippedFiles.find((path) => !builtFiles.includes(path));

	if (extra !== undefined) {
		return `${extra} is in the shipped copy but is no longer built`;
	}

	const changed = builtFiles.find((path) => !readFileSync(join(built, path)).equals(readFileSync(join(shipped, path))));

	return changed === undefined ? undefined : `${changed} differs`;
};

/** A git command's stdout, or undefined when git exits non-zero (an unknown ref, usually). */
const git = ({ args }) => {
	try {
		return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return undefined;
	}
};

/**
 * True when a path differs between a base commit and the WORKING TREE.
 *
 * The tree, not HEAD. The moment the version answer matters most is the moment
 * before the commit — `pnpm bundle` has just rewritten plugin/dist/cli.mjs and
 * it is sitting unstaged. Compared against HEAD, that rebuild is invisible, so
 * the check reported "nothing under plugin/ changed" while git showed 332
 * insertions in the same file, and asked for no bump. Omitting `...HEAD` makes
 * git compare the base against the tree, which is what the other half of this
 * script already measures.
 */
const changedSince = ({ baseCommit, path }) => {
	// `git diff --quiet` says "identical" by exiting 0 and "differs" by exiting
	// 1, so the answer is in the exit code rather than the output.
	try {
		execFileSync('git', ['diff', '--quiet', baseCommit, '--', path], { cwd: repoRoot, stdio: 'ignore' });

		return false;
	} catch {
		return true;
	}
};

/** Compares by numeric segment. True only when `head` is genuinely newer, so a version that moved backwards fails too. */
const isNewer = ({ head, base }) => {
	const segments = (version) => version.split('.').map((segment) => Number.parseInt(segment, 10) || 0);
	const [headSegments, baseSegments] = [segments(head), segments(base)];

	for (let index = 0; index < Math.max(headSegments.length, baseSegments.length); index += 1) {
		const [left, right] = [headSegments[index] ?? 0, baseSegments[index] ?? 0];

		if (left !== right) {
			return left > right;
		}
	}

	return false;
};

/**
 * The version verdict for one shipped directory: a problem, or why it was
 * skipped, or what it compared.
 *
 * The working tree is compared, not HEAD, so an uncommitted rebuild demands
 * its bump before the commit rather than after.
 */
const versionVerdict = ({ baseCommit, dir, primaryManifestPath, manifestPaths }) => {
	const currentVersions = manifestPaths.map((manifestPath) => ({
		manifestPath,
		version: JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8')).version,
	}));
	const distinctVersions = new Set(currentVersions.map(({ version }) => version));

	if (distinctVersions.size !== 1) {
		return {
			problem: `${dir}/ host manifests disagree: ${currentVersions.map(({ manifestPath, version }) => `${manifestPath}=${version}`).join(', ')}`,
		};
	}

	if (!changedSince({ baseCommit, path: dir })) {
		return { skipped: `nothing under ${dir}/ changed` };
	}

	const baseManifest = git({ args: ['show', `${baseCommit}:${primaryManifestPath}`] });

	if (baseManifest === undefined) {
		return { skipped: `${primaryManifestPath} does not exist at the base` };
	}

	const [{ version: headVersion }] = currentVersions;
	const baseVersion = JSON.parse(baseManifest).version;

	if (!isNewer({ head: headVersion, base: baseVersion })) {
		return {
			problem: `${dir}/ changed, which is what users install, but its host manifests are ${headVersion} against a base of ${baseVersion} — bump them so the shipped build has a name of its own`,
		};
	}

	return { checked: `${dir}/ version ${baseVersion} -> ${headVersion}` };
};

/**
 * @param base - git ref the version is compared against. Defaults to `origin/main`.
 * @returns every problem found, and one note per shipped directory saying what the version check did or why it was skipped
 */
export const checkShipped = async ({ base = 'origin/main' } = {}) => {
	const problems = [];
	const work = mkdtempSync(join(tmpdir(), 'lightsout-shipped-'));

	try {
		await buildEngine({ out: join(work, 'cli.mjs') });

		if (!readFileSync(join(work, 'cli.mjs')).equals(readFileSync(join(repoRoot, 'plugin', 'dist', 'cli.mjs')))) {
			problems.push('plugin/dist/cli.mjs does not match packages/engine/src/');
		}

		execFileSync('node', [join(repoRoot, 'scripts', 'copyStandards.mjs'), '--out', join(work, 'standards')], { cwd: repoRoot, stdio: 'ignore' });

		const difference = firstDifference({ built: join(work, 'standards'), shipped: join(repoRoot, 'plugin', 'standards') });

		if (difference !== undefined) {
			problems.push(`plugin/standards/ does not match packages/standards-typescript/ — ${difference}`);
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}

	const baseCommit = git({ args: ['merge-base', base, 'HEAD'] });

	if (baseCommit === undefined) {
		return { problems, versionNotes: [`version not checked: no ${base} to compare against`] };
	}

	const versionNotes = shippedDirectories.map((shipped) => {
		const verdict = versionVerdict({ baseCommit, ...shipped });

		if (verdict.problem !== undefined) {
			problems.push(verdict.problem);
		}

		return verdict.checked ?? `version not checked: ${verdict.skipped ?? verdict.problem}`;
	});

	return { problems, versionNotes };
};

/**
 * Exit codes are set rather than forced with `process.exit`. When stdout is a
 * pipe — which is every caller that matters here, the hook and CI — writes are
 * asynchronous, and exiting on the line after a log discards it. The check
 * would then fail with nothing printed about why.
 */
const main = async () => {
	const baseFlag = process.argv.indexOf('--base');

	if (baseFlag !== -1 && process.argv[baseFlag + 1] === undefined) {
		console.error('--base needs a git ref');
		process.exitCode = 1;

		return;
	}

	const { problems, versionNotes } = await checkShipped({ base: baseFlag === -1 ? undefined : process.argv[baseFlag + 1] });

	if (problems.length === 0) {
		console.log(`shipped plugins are current · ${versionNotes.join(' · ')}`);

		return;
	}

	console.error('');

	for (const problem of problems) {
		console.error(`  ${problem}`);
	}

	console.error('');
	console.error('  plugin/ and plugin-linear/ are what a marketplace install copies and runs.');
	console.error('');
	console.error('    pnpm bundle && git add plugin/');
	console.error('');
	process.exitCode = 1;
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	await main();
}

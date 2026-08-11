import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEngine } from './buildEngine.mjs';

/**
 * Is `plugin/` shippable?
 *
 * A marketplace install copies `plugin/` and nothing else, so merging to main
 * is what reaches users. Three things have to hold, and this is the only
 * definition of them: the pre-push hook runs it for a fast local answer, and
 * CI runs the same file as the authority. Written twice, the two would agree
 * today and drift by the spring, and the one you trust would be whichever you
 * read last.
 *
 *   1. `plugin/dist/cli.mjs` is what `src/` currently builds to.
 *   2. `plugin/standards/` is what the authored default package currently
 *      builds to.
 *   3. If either moved, `plugin.json` carries a version of its own — users
 *      cannot tell two builds apart when both call themselves 0.2.4.
 *
 * Both halves rebuild through the same functions `pnpm bundle` uses, into a
 * throwaway directory. Nothing is written into the working tree: a check that
 * repairs what it measures reports success and leaves the fix uncommitted.
 *
 * `--base <ref>` picks what the version is compared against (default
 * `origin/main`). A missing ref, or a base that already contains this commit,
 * skips the version question rather than inventing an answer — that is the
 * push to main itself, where there is nothing to bump against.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join('plugin', '.claude-plugin', 'plugin.json');

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

/** True when a path changed between a base commit and HEAD. */
const changedSince = ({ baseCommit, path }) => {
	// `git diff --quiet` says "identical" by exiting 0 and "differs" by exiting
	// 1, so the answer is in the exit code rather than the output.
	try {
		execFileSync('git', ['diff', '--quiet', `${baseCommit}...HEAD`, '--', path], { cwd: repoRoot, stdio: 'ignore' });

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
 * @param base - git ref the version is compared against. Defaults to `origin/main`.
 * @returns every problem found, and what the version check did or why it was skipped
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
		return { problems, versionSkipped: `no ${base} to compare against` };
	}

	if (!changedSince({ baseCommit, path: 'plugin' })) {
		return { problems, versionSkipped: 'nothing under plugin/ changed' };
	}

	const baseManifest = git({ args: ['show', `${baseCommit}:${manifestPath}`] });

	if (baseManifest === undefined) {
		return { problems, versionSkipped: `${manifestPath} does not exist at the base` };
	}

	const headVersion = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8')).version;
	const baseVersion = JSON.parse(baseManifest).version;

	if (!isNewer({ head: headVersion, base: baseVersion })) {
		problems.push(
			`plugin/ changed, which is what users install, but ${manifestPath} is ${headVersion} against a base of ${baseVersion} — bump it so the shipped build has a name of its own`,
		);
	}

	return { problems, versionChecked: `${baseVersion} -> ${headVersion}` };
};

/**
 * True when this file was run as a command rather than imported.
 *
 * Compared through realpath on both sides: a path can reach the same file
 * through a symlink — every macOS temp directory does — and a plain string
 * comparison would then decide it was imported, run nothing, and exit 0. For a
 * gate, silently passing is the worst answer available.
 */
const invokedDirectly = (() => {
	if (process.argv[1] === undefined) {
		return false;
	}

	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
})();

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

	const { problems, versionChecked, versionSkipped } = await checkShipped({ base: baseFlag === -1 ? undefined : process.argv[baseFlag + 1] });

	if (problems.length === 0) {
		console.log(`shipped plugin is current · ${versionChecked ? `version ${versionChecked}` : `version not checked: ${versionSkipped}`}`);

		return;
	}

	console.error('');

	for (const problem of problems) {
		console.error(`  ${problem}`);
	}

	console.error('');
	console.error('  plugin/ is what a marketplace install copies and runs.');
	console.error('');
	console.error('    pnpm bundle && git add plugin/');
	console.error('');
	process.exitCode = 1;
};

if (invokedDirectly) {
	await main();
}

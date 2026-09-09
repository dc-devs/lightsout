import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { buildEngine } from './buildEngine.mjs';
import { invokedDirectly } from './invokedDirectly.mjs';
import { changedSince } from './shipRelease/changedSince.mjs';
import { isNewer } from './shipRelease/isNewer.mjs';
import { repoRoot } from './shipRelease/repoRoot.mjs';
import { resolveShipBaseCommit } from './shipRelease/resolveShipBaseCommit.mjs';
import { runGit } from './shipRelease/runGit.mjs';
import { shippedDirectories } from './shipRelease/shippedDirectories.mjs';

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

/**
 * The version verdict for one shipped directory: a problem, or why it was
 * skipped, or what it compared.
 *
 * The working tree is compared, not HEAD, so an uncommitted rebuild demands
 * its bump before the commit rather than after.
 */
const versionVerdict = ({ baseCommit, dir, primaryManifestPath, manifestPaths }) => {
	if (!existsSync(join(repoRoot, dir))) {
		return { skipped: `${dir}/ does not exist in the working tree` };
	}

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

	const baseManifest = runGit({ args: ['show', `${baseCommit}:${primaryManifestPath}`] });

	if (baseManifest === undefined) {
		return { skipped: `${primaryManifestPath} does not exist at the base` };
	}

	const [{ version: headVersion }] = currentVersions;
	const baseVersion = JSON.parse(baseManifest).version;

	if (!isNewer({ head: headVersion, base: baseVersion })) {
		return {
			problem:
				`${dir}/ changed, which is what users install, but its host manifests are ${headVersion} against a base of ${baseVersion}` +
				' — bump them so the shipped build has a name of its own',
		};
	}

	return { checked: `${dir}/ version ${baseVersion} -> ${headVersion}` };
};

/**
 * Checks shipped build parity, manifest agreement, and version movement
 * against a base ref.
 *
 * @param base - git ref the version is compared against when no exact commit is pinned. Defaults to `origin/main`.
 * @param baseCommit - the exact commit to compare against, overriding `base`. Defaults to `LIGHTSOUT_SHIP_BASE_COMMIT`.
 * @returns every problem found, and one note per shipped directory saying what the version check did or why it was skipped
 */
export const checkShipped = async ({ base = 'origin/main', baseCommit: pinnedBase } = {}) => {
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

	const { baseCommit, problem, skipped } = resolveShipBaseCommit({ base, baseCommit: pinnedBase });

	if (baseCommit === undefined) {
		if (problem !== undefined) {
			problems.push(problem);
		}

		return { problems, versionNotes: [skipped ?? `version not checked: ${problem}`] };
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
 * Exit codes are set rather than forced with `process.exit`: stdout is a pipe
 * for every caller that matters here, so exiting on the line after a log would
 * discard it and the check would fail with nothing printed about why.
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
	console.error('  plugin/, plugin-linear/, and plugin-jira/ are what a marketplace install copies and runs.');
	console.error('');
	console.error('    pnpm bundle && git add plugin/ plugin-linear/ plugin-jira/');
	console.error('');
	process.exitCode = 1;
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	await main();
}

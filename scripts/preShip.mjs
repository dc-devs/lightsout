import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Make the tree shippable — the repository's `ship.pre-ship` command.
 *
 * Two conventions guard a push here (see `.githooks/pre-push` and
 * `scripts/checkShipped.mjs`): the shipped plugin directories must match what
 * the sources build to, and a shipped directory that changed must carry a new
 * version. A human ships by running `pnpm bundle` and bumping by hand; this
 * script is that habit as code, so an unattended ship — the queue's — meets
 * the same bar without a human in the loop.
 *
 * It rebuilds first and bumps second, because the rebuild is itself a change
 * the version question must see. Only the patch segment moves, from the BASE
 * version rather than the head one, so serial queue merges each bump exactly
 * one step above whatever main holds at their turn. Nothing is committed —
 * the engine's pre-ship step commits whatever this leaves behind.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The directories a marketplace install copies, with every host manifest that names the same build — the same list `checkShipped.mjs` guards. */
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

/** A git command's stdout, or undefined when git exits non-zero (an unknown ref, usually). */
const git = ({ args }) => {
	try {
		return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return undefined;
	}
};

/** True when a path differs between the base commit and the working tree — the tree, so a fresh rebuild counts. */
const changedSince = ({ baseCommit, path }) => {
	try {
		execFileSync('git', ['diff', '--quiet', baseCommit, '--', path], { cwd: repoRoot, stdio: 'ignore' });

		return false;
	} catch {
		return true;
	}
};

/** Compares by numeric segment. True only when `head` is genuinely newer. */
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

/** The base version with its patch segment moved one step — `0.37.0` becomes `0.37.1`. */
const bumpPatch = ({ version }) => {
	const segments = version.split('.').map((segment) => Number.parseInt(segment, 10) || 0);

	while (segments.length < 3) {
		segments.push(0);
	}

	segments[segments.length - 1] += 1;

	return segments.join('.');
};

/** Rewrite just the version value in place, so the manifest keeps its exact formatting. */
const writeVersion = ({ manifestPath, from, to }) => {
	const absolute = join(repoRoot, manifestPath);
	const manifest = readFileSync(absolute, 'utf8');

	writeFileSync(absolute, manifest.replace(`"version": "${from}"`, `"version": "${to}"`), 'utf8');
};

export const preShip = () => {
	execFileSync('pnpm', ['bundle'], { cwd: repoRoot, stdio: 'inherit' });

	const baseCommit = git({ args: ['merge-base', 'origin/main', 'HEAD'] });

	if (baseCommit === undefined) {
		console.log('pre-ship: no origin/main to compare against — bundled, versions untouched');

		return;
	}

	for (const { dir, primaryManifestPath, manifestPaths } of shippedDirectories) {
		if (!changedSince({ baseCommit, path: dir })) {
			continue;
		}

		const baseManifest = git({ args: ['show', `${baseCommit}:${primaryManifestPath}`] });

		if (baseManifest === undefined) {
			continue;
		}

		const headVersion = JSON.parse(readFileSync(join(repoRoot, primaryManifestPath), 'utf8')).version;
		const baseVersion = JSON.parse(baseManifest).version;
		const targetVersion = isNewer({ head: headVersion, base: baseVersion }) ? headVersion : bumpPatch({ version: baseVersion });

		for (const manifestPath of manifestPaths) {
			const currentVersion = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8')).version;

			if (currentVersion !== targetVersion) {
				writeVersion({ manifestPath, from: currentVersion, to: targetVersion });
			}
		}

		console.log(`pre-ship: ${dir}/ host manifests ${baseVersion} -> ${targetVersion}`);
	}
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	preShip();
}

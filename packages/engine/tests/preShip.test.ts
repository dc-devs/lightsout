import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { commitAll } from '#tests/helpers/commitAll.ts';
import { runInRepo } from '#tests/helpers/runInRepo.ts';

const repoRoot = join(__dirname, '..', '..', '..');

/**
 * A stand-in for the sibling parity check, recording the base commit the hook
 * hands it. The real script builds the engine and diffs the shipped plugin
 * trees, which a synthetic fixture has neither the sources nor the seconds for;
 * its own suite covers what it answers. What matters here is that preparation
 * verifies against the SAME pinned commit it versioned against.
 */
const checkShippedStub = [
	"import { appendFileSync } from 'node:fs';",
	"import { dirname, join } from 'node:path';",
	"import { fileURLToPath } from 'node:url';",
	'',
	"const logPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-shipped-calls.log');",
	'',
	'export const checkShipped = async ({ baseCommit } = {}) => {',
	"\tappendFileSync(logPath, `${baseCommit ?? 'no-base-commit'}\\n`, 'utf8');",
	'',
	'\treturn { problems: [], versionNotes: [] };',
	'};',
	'',
].join('\n');

const setup = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-pre-ship-'));
	const scriptsDir = join(cwd, 'scripts');
	const pluginDir = join(cwd, 'plugin-jira');
	const claudeManifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
	const codexManifestPath = join(pluginDir, '.codex-plugin', 'plugin.json');
	const skillPath = join(pluginDir, 'skills', 'jira-ticket', 'SKILL.md');
	const binDir = join(cwd, 'test-bin');

	await Promise.all([
		mkdir(scriptsDir, { recursive: true }),
		mkdir(join(pluginDir, '.claude-plugin'), { recursive: true }),
		mkdir(join(pluginDir, '.codex-plugin'), { recursive: true }),
		mkdir(join(pluginDir, 'skills', 'jira-ticket'), { recursive: true }),
		mkdir(binDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(scriptsDir, 'preShip.mjs'), await readFile(join(repoRoot, 'scripts', 'preShip.mjs'), 'utf8')),
		writeFile(join(scriptsDir, 'invokedDirectly.mjs'), await readFile(join(repoRoot, 'scripts', 'invokedDirectly.mjs'), 'utf8')),
		cp(join(repoRoot, 'scripts', 'shipRelease'), join(scriptsDir, 'shipRelease'), { recursive: true }),
		writeFile(join(scriptsDir, 'checkShipped.mjs'), checkShippedStub),
		writeFile(claudeManifestPath, '{"name": "lightsout-jira", "version": "0.1.0"}\n'),
		writeFile(codexManifestPath, '{"name": "lightsout-jira", "version": "0.1.0"}\n'),
		writeFile(skillPath, 'baseline\n'),
		writeFile(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n'),
	]);
	await chmod(join(binDir, 'pnpm'), 0o755);

	runInRepo({ cwd, command: 'git', args: ['init', '-q', '-b', 'main'] });
	commitAll({ cwd, message: 'baseline' });
	runInRepo({ cwd, command: 'git', args: ['update-ref', 'refs/remotes/origin/main', 'main'] });
	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', '-b', 'feature'] });
	await writeFile(skillPath, 'changed\n');

	const invoke = async () => {
		const output = execFileSync('node', [join(scriptsDir, 'preShip.mjs')], {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
		});
		const [claudeManifest, codexManifest] = await Promise.all(
			[claudeManifestPath, codexManifestPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
		);

		return { output, claudeManifest, codexManifest };
	};

	return { cwd, invoke };
};

/**
 * The shape a ship integration is in when the hook runs: main has published a
 * newer version, the feature branch's own commit predates it, and the merge
 * bringing main in is open with HEAD still on the feature commit.
 *
 * The fork point — what the old merge-base lookup would find — carries version
 * 0.1.0, while the fetched base carries 0.2.0. A bump measured from the fork
 * point lands on 0.1.1, under a version users already have.
 */
const setupPinnedBase = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-pre-ship-pinned-'));
	const scriptsDir = join(cwd, 'scripts');
	const pluginDir = join(cwd, 'plugin-jira');
	const claudeManifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
	const codexManifestPath = join(pluginDir, '.codex-plugin', 'plugin.json');
	const skillPath = join(pluginDir, 'skills', 'jira-ticket', 'SKILL.md');
	const binDir = join(cwd, 'test-bin');
	const checkLogPath = join(cwd, 'check-shipped-calls.log');
	const manifest = ({ version }: { version: string }) => `{"name": "lightsout-jira", "version": "${version}"}\n`;

	await Promise.all([
		mkdir(scriptsDir, { recursive: true }),
		mkdir(join(pluginDir, '.claude-plugin'), { recursive: true }),
		mkdir(join(pluginDir, '.codex-plugin'), { recursive: true }),
		mkdir(join(pluginDir, 'skills', 'jira-ticket'), { recursive: true }),
		mkdir(binDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(scriptsDir, 'preShip.mjs'), await readFile(join(repoRoot, 'scripts', 'preShip.mjs'), 'utf8')),
		writeFile(join(scriptsDir, 'invokedDirectly.mjs'), await readFile(join(repoRoot, 'scripts', 'invokedDirectly.mjs'), 'utf8')),
		cp(join(repoRoot, 'scripts', 'shipRelease'), join(scriptsDir, 'shipRelease'), { recursive: true }),
		writeFile(join(scriptsDir, 'checkShipped.mjs'), checkShippedStub),
		writeFile(claudeManifestPath, manifest({ version: '0.1.0' })),
		writeFile(codexManifestPath, manifest({ version: '0.1.0' })),
		writeFile(skillPath, 'baseline\n'),
		writeFile(checkLogPath, ''),
		writeFile(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n'),
	]);
	await chmod(join(binDir, 'pnpm'), 0o755);

	runInRepo({ cwd, command: 'git', args: ['init', '-q', '-b', 'main'] });
	commitAll({ cwd, message: 'fork point' });
	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', '-b', 'feature'] });
	await writeFile(skillPath, 'changed on the feature branch\n');
	commitAll({ cwd, message: 'feature work' });

	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', 'main'] });
	await Promise.all([writeFile(claudeManifestPath, manifest({ version: '0.2.0' })), writeFile(codexManifestPath, manifest({ version: '0.2.0' }))]);
	commitAll({ cwd, message: 'publish 0.2.0' });
	const baseCommit = runInRepo({ cwd, command: 'git', args: ['rev-parse', 'HEAD'] }).trim();

	runInRepo({ cwd, command: 'git', args: ['update-ref', 'refs/remotes/origin/main', 'main'] });
	runInRepo({ cwd, command: 'git', args: ['checkout', '-q', 'feature'] });
	const featureHead = runInRepo({ cwd, command: 'git', args: ['rev-parse', 'HEAD'] }).trim();

	runInRepo({ cwd, command: 'git', args: ['merge', '--no-commit', '--no-ff', baseCommit] });

	const invoke = async () => {
		const output = execFileSync('node', [join(scriptsDir, 'preShip.mjs')], {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, LIGHTSOUT_SHIP_BASE_COMMIT: baseCommit },
		});
		const [claudeManifest, codexManifest] = await Promise.all(
			[claudeManifestPath, codexManifestPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
		);

		return { output, claudeManifest, codexManifest };
	};

	const readState = async () => ({
		head: runInRepo({ cwd, command: 'git', args: ['rev-parse', 'HEAD'] }).trim(),
		mergeHead: runInRepo({ cwd, command: 'git', args: ['rev-parse', 'MERGE_HEAD'] }).trim(),
		verifiedBases: (await readFile(checkLogPath, 'utf8')).split('\n').filter((line) => line !== ''),
	});

	return { cwd, baseCommit, featureHead, invoke, readState };
};

describe('preShip', () => {
	test('bumps both Jira host manifests when the Jira plugin changes', async () => {
		const { cwd, invoke } = await setup();

		try {
			const result = await invoke();

			expect(result).toEqual({
				output: expect.stringContaining('pre-ship: plugin-jira/ host manifests 0.1.0 -> 0.1.1'),
				claudeManifest: { name: 'lightsout-jira', version: '0.1.1' },
				codexManifest: { name: 'lightsout-jira', version: '0.1.1' },
			});
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test('prepares versions against the pinned base before the merge is committed', async () => {
		const { cwd, baseCommit, featureHead, invoke, readState } = await setupPinnedBase();

		try {
			const first = await invoke();
			const repeated = await invoke();
			const state = await readState();

			expect({ first, repeated, state }).toEqual({
				first: {
					output: expect.stringContaining('pre-ship: plugin-jira/ host manifests 0.2.0 -> 0.2.1'),
					claudeManifest: { name: 'lightsout-jira', version: '0.2.1' },
					codexManifest: { name: 'lightsout-jira', version: '0.2.1' },
				},
				repeated: {
					output: expect.any(String),
					claudeManifest: { name: 'lightsout-jira', version: '0.2.1' },
					codexManifest: { name: 'lightsout-jira', version: '0.2.1' },
				},
				state: { head: featureHead, mergeHead: baseCommit, verifiedBases: [baseCommit, baseCommit] },
			});
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

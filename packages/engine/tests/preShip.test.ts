import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

const repoRoot = join(__dirname, '..', '..', '..');

const run = ({ cwd, command, args }: { cwd: string; command: string; args: string[] }) =>
	execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const commitAll = ({ cwd, message }: { cwd: string; message: string }) => {
	run({ cwd, command: 'git', args: ['add', '-A'] });
	run({ cwd, command: 'git', args: ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message] });
};

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
		writeFile(claudeManifestPath, '{"name": "lightsout-jira", "version": "0.1.0"}\n'),
		writeFile(codexManifestPath, '{"name": "lightsout-jira", "version": "0.1.0"}\n'),
		writeFile(skillPath, 'baseline\n'),
		writeFile(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n'),
	]);
	await chmod(join(binDir, 'pnpm'), 0o755);

	run({ cwd, command: 'git', args: ['init', '-q', '-b', 'main'] });
	commitAll({ cwd, message: 'baseline' });
	run({ cwd, command: 'git', args: ['update-ref', 'refs/remotes/origin/main', 'main'] });
	run({ cwd, command: 'git', args: ['checkout', '-q', '-b', 'feature'] });
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
});

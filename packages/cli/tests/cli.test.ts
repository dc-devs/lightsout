import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The CLI has no in-process seam (process.exit + hard-wired getDriver), so
// characterization runs it as a subprocess and pins EXACT stdout/stderr/exit.
// The bundle under test is produced by the root `test` script from CURRENT
// source (.test-dist/cli-under-test.mjs), never the committed plugin bundle.
const CLI = join(process.cwd(), '.test-dist', 'cli-under-test.mjs');

// Byte-exact copy of the CLI's `usage` constant. console.error(usage) appends
// one newline; the constant already ends in a newline, so error output ends
// with two. Pinning this whole block is the point of characterization: if a
// refactor changes it, this suite goes red and the refactor is wrong.
const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout doctor [--cwd <path>]
  lightsout scan [--cwd <path>] [--path <subdir>] [--all] [--baseline]
  lightsout traverse "<question>" --start <edge-or-node> [--connections <dir>] [--budget <n>] [--data <field>] [--cwd <path>]
  lightsout traverse --run <id> [--cwd <path>]        (resume a parked/budget-exhausted traversal)
  lightsout debug "<symptoms>" [--start <node>] [--at <file:line>] [--suspect <hash>] [--connections <dir>] [--budget <n>] [--cwd <path>]
  lightsout debug --run <id> [--cwd <path>]           (resume a parked/budget-exhausted debug run)
  lightsout build-map <node...|all> [--connections <dir>] [--rescan] [--cwd <path>]
  lightsout build-map --author <run-id> [--connections <dir>] [--cwd <path>]   (post-review: write docs from a culled join.json)
  lightsout map-connection verify [<doc-id>...] [--repair] [--connections <dir>] [--cwd <path>]
  lightsout map-connection draft --run <traverse-run-id> [--connections <dir>] [--cwd <path>]
  lightsout plan explore "<request>" --name <n> [--areas <a,b>] [--cwd <path>]
  lightsout plan draft --name <n> [--scope single|phased] [--plans <dir>] [--cwd <path>]
  lightsout plan dedup --name <n> [--plans <dir>] [--cwd <path>]
  lightsout plan grade --name <n> [--plans <dir>] [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
`;

const usageErr = `${usage}\n`;

const runCli = ({ args }: { args: string[] }) =>
	new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
		const child = spawn(process.execPath, [CLI, ...args]);

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ stdout, stderr, code }));
	});

const freshCwd = async () => mkdtemp(join(tmpdir(), 'lightsout-cli-'));

test('cli: no args prints usage to stderr and exits 0', async () => {
	const { stdout, stderr, code } = await runCli({ args: [] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 0);
});

test('cli: help prints usage to stderr and exits 0', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['help'] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 0);
});

test('cli: an unknown command prints usage to stderr and exits 1', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['nonsense'] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

test('cli: status in a fresh dir reports no runs and exits 0', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	assert.equal(stdout, 'no runs found\n');
	assert.equal(stderr, '');
	assert.equal(code, 0);
});

test('cli: friction in a fresh dir reports nothing recorded and exits 0', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['friction', '--cwd', cwd] });

	assert.equal(stdout, 'no friction recorded\n');
	assert.equal(stderr, '');
	assert.equal(code, 0);
});

test('cli: implement without --plan prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['implement', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

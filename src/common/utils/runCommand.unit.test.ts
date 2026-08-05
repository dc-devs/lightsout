import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCommand } from '@/common/utils/runCommand';

const setupCwd = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-runcommand-'));

	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(cwd, name), content);
	}

	return { cwd };
};

test('runCommand: a green command resolves with exit code 0 and its captured stdout', async () => {
	const { cwd } = setupCwd();

	const result = await runCommand({ command: 'echo gate-output', cwd });

	assert.deepEqual(result, { exitCode: 0, stdout: 'gate-output\n', stderr: '' });
});

test('runCommand: a red exit is a result, not an exception — the engine owns what failure means', async () => {
	const { cwd } = setupCwd();

	const result = await runCommand({ command: 'echo boom 1>&2; exit 3', cwd });

	assert.deepEqual(result, { exitCode: 3, stdout: '', stderr: 'boom\n' }, 'a non-zero gate exit must reach the caller as data, so the pipeline can record it and continue');
});

test('runCommand: the command runs in the given cwd, not the engine process cwd', async () => {
	const { cwd } = setupCwd({ files: { 'marker.txt': 'here\n' } });

	const result = await runCommand({ command: 'cat marker.txt', cwd });

	assert.deepEqual(result, { exitCode: 0, stdout: 'here\n', stderr: '' });
});

test('runCommand: a command that outlives its timeout is killed and rejects naming the ceiling', async () => {
	const { cwd } = setupCwd();

	await assert.rejects(
		runCommand({ command: 'sleep 30', cwd, timeoutMs: 50 }),
		(error: unknown) => error instanceof Error && error.message === 'command timed out after 50ms: sleep 30',
	);
});

test('runCommand: a command killed by a signal reports exit code -1 rather than a null code', async () => {
	const { cwd } = setupCwd();

	const result = await runCommand({ command: 'kill -9 $$', cwd });

	assert.equal(result.exitCode, -1, 'a signalled death carries no exit code — the gate still gets a number it can judge as failure');
});

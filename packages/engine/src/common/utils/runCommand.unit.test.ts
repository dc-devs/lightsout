import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runCommand } from '#src/common/utils/runCommand.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

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

	expect(result).toStrictEqual({ exitCode: 0, stdout: 'gate-output\n', stderr: '' });
});

test('runCommand: a red exit is a result, not an exception — the engine owns what failure means', async () => {
	const { cwd } = setupCwd();

	const result = await runCommand({ command: 'echo boom 1>&2; exit 3', cwd });

	// a non-zero gate exit must reach the caller as data, so the pipeline can
	// record it and continue
	expect(result).toStrictEqual({ exitCode: 3, stdout: '', stderr: 'boom\n' });
});

test('runCommand: the command runs in the given cwd, not the engine process cwd', async () => {
	const { cwd } = setupCwd({ files: { 'marker.txt': 'here\n' } });

	const result = await runCommand({ command: 'cat marker.txt', cwd });

	expect(result).toStrictEqual({ exitCode: 0, stdout: 'here\n', stderr: '' });
});

test('runCommand: a command that outlives its timeout is killed and rejects naming the ceiling', async () => {
	const { cwd } = setupCwd();

	const error = await getRejectionError({ promise: runCommand({ command: 'sleep 30', cwd, timeoutMs: 50 }) });

	expect(error.message).toBe('command timed out after 50ms: sleep 30');
});

test('runCommand: a command killed by a signal reports exit code -1 rather than a null code', async () => {
	const { cwd } = setupCwd();

	const result = await runCommand({ command: 'kill -9 $$', cwd });

	// a signalled death carries no exit code — the gate still gets a number it can
	// judge as failure
	expect(result.exitCode).toBe(-1);
});

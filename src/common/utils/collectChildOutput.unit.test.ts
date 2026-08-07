import { spawn } from 'node:child_process';
import { expect, test } from '@jest/globals';
import { collectChildOutput } from '@/common/utils/collectChildOutput';
import { getRejectionError } from '@tests/helpers/getRejectionError';

/**
 * A shell child with both output streams piped, spawned detached — the shape
 * every caller hands in. Detached matters: it makes the child its own
 * process-group leader, which is what lets a timeout kill the tree it started.
 */
const shellChild = ({ script }: { script: string }) => spawn(script, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

test('collectChildOutput: both streams are collected and the exit code is a result, not an exception', async () => {
	const result = await collectChildOutput({ child: shellChild({ script: 'echo out; echo err 1>&2; exit 3' }) });

	// a non-zero exit reaches the caller as data — the caller owns what failure means
	expect(result).toStrictEqual({ exitCode: 3, stdout: 'out\n', stderr: 'err\n' });
});

test('collectChildOutput: a signalled death reports -1 rather than a null code', async () => {
	const result = await collectChildOutput({ child: shellChild({ script: 'kill -9 $$' }) });

	expect(result.exitCode).toBe(-1);
});

test('collectChildOutput: a child that outlives its deadline is killed and rejects with the caller-supplied message', async () => {
	const error = await getRejectionError({
		promise: collectChildOutput({ child: shellChild({ script: 'sleep 30' }), timeout: { ms: 50, message: 'gate timed out after 50ms' } }),
	});

	// the message is the caller's, so each caller keeps its own phrasing
	expect(error.message).toBe('gate timed out after 50ms');
});

test('collectChildOutput: a child that never spawns rejects with the spawn error', async () => {
	const error = await getRejectionError({
		promise: collectChildOutput({ child: spawn('lightsout-no-such-binary', [], { stdio: ['ignore', 'pipe', 'pipe'] }) }),
	});

	expect(error.message).toMatch(/ENOENT/);
});

test('collectChildOutput: complete stdout lines stream as they arrive, blanks skipped, and the trailing partial flushes on close', async () => {
	const lines: string[] = [];

	// no trailing newline after `tail` — it is only a whole line once close proves
	// nothing more is coming
	const result = await collectChildOutput({
		child: shellChild({ script: "printf 'first\\nsecond\\n\\n   \\ntail'" }),
		onStdoutLine: (line) => lines.push(line),
	});

	expect(lines).toStrictEqual(['first', 'second', 'tail']);
	// streaming never costs the caller the full capture
	expect(result.stdout).toBe('first\nsecond\n\n   \ntail');
});

test('collectChildOutput: stdout is still captured in full when no line sink is given', async () => {
	const result = await collectChildOutput({ child: shellChild({ script: "printf 'one\\ntwo\\n'" }) });

	expect(result.stdout).toBe('one\ntwo\n');
});

test('collectChildOutput: a deadline takes the tree with it, not just the process it spawned', async () => {
	const child = shellChild({ script: 'sleep 30 & echo $!; wait' });
	const grandchildPid = await new Promise<number>((resolve) => {
		child.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
	});
	const alive = () => {
		try {
			process.kill(grandchildPid, 0);

			return true;
		} catch {
			return false;
		}
	};

	const error = await getRejectionError({
		promise: collectChildOutput({ child, timeout: { ms: 50, message: 'gate timed out after 50ms' } }),
	});

	expect(error.message).toBe('gate timed out after 50ms');

	// killing only the direct child would leave this running, holding the
	// stdout pipe it inherited, with nothing left to reap it
	for (let attempt = 1; attempt <= 100 && alive(); attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	expect(alive()).toBe(false);
});

test('collectChildOutput: the deadline asks before it insists, so a child can flush what it owns', async () => {
	const lines: string[] = [];
	const child = shellChild({ script: "trap 'echo flushed-on-term; exit 0' TERM; sleep 30 & wait" });

	await getRejectionError({
		promise: collectChildOutput({ child, timeout: { ms: 80, message: 'timed out' }, onStdoutLine: (line) => lines.push(line) }),
	});

	// The caller is rejected at the deadline and never sees this output — the
	// point is that the child got a signal it could CATCH, so its own cleanup
	// ran. SIGKILL cannot be caught, so leading with it would strand the temp
	// files and half-written transcripts a harness removes on its way out.
	await new Promise((resolve) => child.once('close', resolve));

	expect(lines).toContain('flushed-on-term');
});

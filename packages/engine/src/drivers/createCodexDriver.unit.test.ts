import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, test } from '@jest/globals';
import { Effort, Permissions } from '#src/contracts/index.ts';
import { createCodexDriver } from '#src/drivers/index.ts';

// The `codex` binary is the one unowned boundary here, so each setup writes a
// fake one onto PATH: it records the argv and stdin it was handed, writes the
// scenario's final message to whatever `--output-last-message` names, and exits
// with the scenario's code. Nothing else is stubbed — the driver under test is
// the real one, spawning a real process.
const realPath = process.env.PATH ?? '';

afterAll(() => {
	process.env.PATH = realPath;
});

const setupCodex = async ({
	exitCode = 0,
	stdout = '',
	stderr = '',
	lastMessage = 'FINAL-MESSAGE',
}: {
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	lastMessage?: string;
} = {}) => {
	const dir = await mkdtemp(join(tmpdir(), 'lightsout-codex-driver-'));
	const binDir = join(dir, 'bin');
	const argvPath = join(dir, 'argv.txt');
	const stdinPath = join(dir, 'stdin.txt');

	await mkdir(binDir);
	await writeFile(
		join(binDir, 'codex'),
		[
			'#!/bin/sh',
			`printf '%s\\n' "$@" > '${argvPath}'`,
			`cat > '${stdinPath}'`,
			"prev=''",
			"out=''",
			'for arg in "$@"; do',
			'  if [ "$prev" = "--output-last-message" ]; then out="$arg"; fi',
			'  prev="$arg"',
			'done',
			`[ -n '${lastMessage}' ] && printf '%s' '${lastMessage}' > "$out"`,
			`printf '%s' '${stdout}'`,
			`printf '%s' '${stderr}' >&2`,
			`exit ${exitCode}`,
		].join('\n'),
		'utf8',
	);
	await chmod(join(binDir, 'codex'), 0o755);

	process.env.PATH = `${binDir}:${realPath}`;

	return {
		driver: createCodexDriver(),
		cwd: dir,
		readArgv: async () => (await readFile(argvPath, 'utf8')).split('\n').slice(0, -1),
		readStdin: async () => readFile(stdinPath, 'utf8'),
	};
};

test('createCodexDriver: the invocation model, effort, and permissions reach the spawned process as flags', async () => {
	const { driver, cwd, readArgv } = await setupCodex();

	await driver.invoke({ prompt: 'TASK', cwd, model: 'gpt-5.2', effort: Effort.High, permissions: Permissions.FullAccess });

	const argv = await readArgv();

	expect(argv.slice(0, 5)).toStrictEqual(['exec', '--skip-git-repo-check', '--color', 'never', '--output-last-message']);
	expect(argv.slice(6)).toStrictEqual(['--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5.2', '-c', 'model_reasoning_effort="high"']);
});

test('createCodexDriver: an invocation carrying none of them spawns a sandboxed process with the approval policy pinned', async () => {
	const { driver, cwd, readArgv } = await setupCodex();

	await driver.invoke({ prompt: 'TASK', cwd });

	const argv = await readArgv();

	expect(argv.slice(6)).toStrictEqual(['--sandbox', 'workspace-write', '-c', 'approval_policy="never"']);
});

test('createCodexDriver: codex has no system-prompt channel, so role instructions ride at the top of stdin', async () => {
	const { driver, cwd, readStdin } = await setupCodex();

	await driver.invoke({ prompt: 'TASK', systemPrompt: 'ROLE', cwd });

	expect(await readStdin()).toBe('# Role instructions\n\nROLE\n\n# Task\n\nTASK');
});

test('createCodexDriver: without a system prompt the task text reaches stdin verbatim', async () => {
	const { driver, cwd, readStdin } = await setupCodex();

	await driver.invoke({ prompt: 'TASK', cwd });

	expect(await readStdin()).toBe('TASK');
});

test('createCodexDriver: the final message is read from the output file, not the event stream', async () => {
	const { driver, cwd } = await setupCodex({ stdout: 'progress chatter the result must not come from' });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'FINAL-MESSAGE', exitCode: 0, rateLimited: false });
});

test('createCodexDriver: a failed spawn whose output names a usage limit reports rateLimited, falling back to stderr for text', async () => {
	const { driver, cwd } = await setupCodex({ exitCode: 1, lastMessage: '', stderr: 'error: usage limit reached, try again later' });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'error: usage limit reached, try again later', exitCode: 1, rateLimited: true });
});

test('createCodexDriver: a zero exit that wrote no final message is still an error path for the rate-limit heuristic', async () => {
	const { driver, cwd } = await setupCodex({ lastMessage: '', stderr: 'quota exhausted' });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'quota exhausted', exitCode: 0, rateLimited: true });
});

test('createCodexDriver: the period-qualified wording the claude harness uses is a wall here too', async () => {
	// The apostrophe is escaped for the single-quoted `printf` inside the fake
	// harness script — the text the driver sees is the original.
	const walled = "You've hit your weekly limit · resets 4am";
	const { driver, cwd } = await setupCodex({ exitCode: 1, lastMessage: '', stderr: walled.replaceAll("'", String.raw`'\''`) });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: walled, exitCode: 1, rateLimited: true });
});

test('createCodexDriver: a bare 529 in ordinary output is no longer parked as an overload', async () => {
	// the shared predicate takes the qualified 529 form, so a token count, a cost
	// or a line number cannot park a run any more
	const { driver, cwd } = await setupCodex({ exitCode: 2, lastMessage: '', stdout: 'boom: wrote 529 tokens before it died' });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result.rateLimited).toBe(false);
});

test('createCodexDriver: an ordinary failure is not misread as a rate limit, and stdout carries the text', async () => {
	const { driver, cwd } = await setupCodex({ exitCode: 2, lastMessage: '', stdout: 'boom: unrecognized subcommand' });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'boom: unrecognized subcommand', exitCode: 2, rateLimited: false });
});

test('createCodexDriver: the temp directory holding the output file is removed once the invocation returns', async () => {
	const { driver, cwd, readArgv } = await setupCodex();

	await driver.invoke({ prompt: 'TASK', cwd });

	const argv = await readArgv();
	const outFile = argv[argv.indexOf('--output-last-message') + 1];

	// the driver cleans up after itself
	expect(existsSync(dirname(outFile))).toBe(false);
});

import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, afterAll } from '@jest/globals';
import { Effort, Permissions } from '@/contracts';
import { createClaudeCodeDriver } from '@/drivers';

// The `claude` binary is the one unowned boundary here, so each setup writes a
// fake one onto PATH: it records the argv and stdin it was handed, copies any
// system-prompt file it was pointed at (the real one is deleted before the
// invocation returns), streams the scenario's stdout, and exits with the
// scenario's code. Nothing else is stubbed — the driver under test is the real
// one, spawning a real process.
const realPath = process.env.PATH ?? '';

afterAll(() => {
	process.env.PATH = realPath;
});

/** One stream-json event as the harness emits it: a complete JSON line. */
const event = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`;

const setupClaude = async ({
	stdoutChunks = [],
	chunkDelay = false,
	stderr = '',
	exitCode = 0,
	delaySeconds = 0,
}: {
	stdoutChunks?: string[];
	chunkDelay?: boolean;
	stderr?: string;
	exitCode?: number;
	delaySeconds?: number;
} = {}) => {
	const dir = await mkdtemp(join(tmpdir(), 'lightsout-claude-driver-'));
	const binDir = join(dir, 'bin');
	const argvPath = join(dir, 'argv.txt');
	const stdinPath = join(dir, 'stdin.txt');
	const promptCopyPath = join(dir, 'system-prompt-copy.md');

	await mkdir(binDir);
	await writeFile(
		join(binDir, 'claude'),
		[
			'#!/bin/sh',
			`printf '%s\\n' "$@" > '${argvPath}'`,
			"prev=''",
			'for arg in "$@"; do',
			`  if [ "$prev" = "--append-system-prompt-file" ]; then cp "$arg" '${promptCopyPath}'; fi`,
			'  prev="$arg"',
			'done',
			`cat > '${stdinPath}'`,
			...(delaySeconds > 0 ? [`sleep ${delaySeconds}`] : []),
			...stdoutChunks.flatMap((chunk, index) => [
				...(index > 0 && chunkDelay ? ['sleep 0.2'] : []),
				`printf '%s' '${chunk}'`,
			]),
			`printf '%s' '${stderr}' >&2`,
			`exit ${exitCode}`,
		].join('\n'),
		'utf8',
	);
	await chmod(join(binDir, 'claude'), 0o755);

	process.env.PATH = `${binDir}:${realPath}`;

	return {
		driver: createClaudeCodeDriver(),
		cwd: dir,
		readArgv: async () => (await readFile(argvPath, 'utf8')).split('\n').slice(0, -1),
		readStdin: async () => readFile(stdinPath, 'utf8'),
		readSystemPromptCopy: async () => readFile(promptCopyPath, 'utf8'),
	};
};

/** A PATH holding no `claude` at all — the harness-not-installed scenario. */
const setupWithoutClaude = async () => {
	const dir = await mkdtemp(join(tmpdir(), 'lightsout-claude-missing-'));
	const binDir = join(dir, 'bin');

	await mkdir(binDir);

	process.env.PATH = binDir;

	return { driver: createClaudeCodeDriver(), cwd: dir };
};

test('createClaudeCodeDriver: the driver reports the harness name the manifest records it under', () => {
	const driver = createClaudeCodeDriver();

	expect(driver.name).toBe('claude-code');
});

test('createClaudeCodeDriver: the invocation model, effort, permissions, and grants reach the spawned process as flags', async () => {
	const { driver, cwd, readArgv } = await setupClaude();

	await driver.invoke({ prompt: 'TASK', cwd, model: 'opus', effort: Effort.XHigh, permissions: Permissions.Write, allowedCommands: ['pnpm'] });

	expect(await readArgv()).toStrictEqual([
		'-p',
		'--output-format',
		'stream-json',
		'--verbose',
		'--exclude-dynamic-system-prompt-sections',
		'--model',
		'opus',
		'--effort',
		'xhigh',
		'--permission-mode',
		'acceptEdits',
		'--allowedTools',
		'Bash(pnpm:*)',
	]);
});

test('createClaudeCodeDriver: the system prompt reaches the harness as a file, not as argv', async () => {
	const { driver, cwd, readSystemPromptCopy } = await setupClaude();

	await driver.invoke({ prompt: 'TASK', systemPrompt: '# Role\n\nBe deterministic.\n', cwd });

	expect(await readSystemPromptCopy()).toBe('# Role\n\nBe deterministic.\n');
});

test('createClaudeCodeDriver: the system prompt file is removed once the invocation returns', async () => {
	const { driver, cwd, readArgv } = await setupClaude();

	await driver.invoke({ prompt: 'TASK', systemPrompt: 'ROLE', cwd });

	const argv = await readArgv();
	const promptPath = argv[argv.indexOf('--append-system-prompt-file') + 1];

	// the temp prompt file outlives only the spawn
	expect(existsSync(promptPath)).toBe(false);
});

test('createClaudeCodeDriver: without a system prompt no prompt-file flag is passed', async () => {
	const { driver, cwd, readArgv } = await setupClaude();

	await driver.invoke({ prompt: 'TASK', cwd });

	expect(await readArgv()).toStrictEqual(['-p', '--output-format', 'stream-json', '--verbose', '--exclude-dynamic-system-prompt-sections']);
});

test('createClaudeCodeDriver: the task prompt rides stdin verbatim, sidestepping the argv ceiling', async () => {
	const { driver, cwd, readStdin } = await setupClaude();

	await driver.invoke({ prompt: 'TASK with — unicode\nand a second line', systemPrompt: 'ROLE', cwd });

	expect(await readStdin()).toBe('TASK with — unicode\nand a second line');
});

test('createClaudeCodeDriver: the final result event supplies the text and the normalized usage', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [
			event({ type: 'assistant', text: 'thinking' }) +
				'\n' +
				'not json at all\n' +
				event({
					type: 'result',
					result: 'FINAL',
					usage: { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 56, cache_creation_input_tokens: 78 },
					total_cost_usd: 0.42,
				}),
		],
	});

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({
		text: 'FINAL',
		exitCode: 0,
		rateLimited: false,
		usage: { inputTokens: 12, outputTokens: 34, cacheReadTokens: 56, cacheCreationTokens: 78, costUsd: 0.42 },
	});
});

test('createClaudeCodeDriver: every parseable streamed event reaches onEvent, blank and non-JSON lines aside', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [event({ type: 'assistant', text: 'thinking' }) + '\n' + 'not json at all\n' + event({ type: 'result', result: 'FINAL' })],
	});
	const seen: unknown[] = [];

	await driver.invoke({ prompt: 'TASK', cwd, onEvent: (streamed) => seen.push(streamed) });

	expect(seen).toStrictEqual([{ type: 'assistant', text: 'thinking' }, { type: 'result', result: 'FINAL' }]);
});

test('createClaudeCodeDriver: a result event reporting neither usage nor cost yields no usage at all', async () => {
	const { driver, cwd } = await setupClaude({ stdoutChunks: [event({ type: 'result', result: 'FINAL' })] });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'FINAL', exitCode: 0, rateLimited: false, usage: undefined });
});

test('createClaudeCodeDriver: a result event carrying only a cost reports it with zeroed token counts', async () => {
	const { driver, cwd } = await setupClaude({ stdoutChunks: [event({ type: 'result', result: 'FINAL', total_cost_usd: 1.25 })] });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({
		text: 'FINAL',
		exitCode: 0,
		rateLimited: false,
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.25 },
	});
});

test('createClaudeCodeDriver: with no result event the whole stdout is parsed as one envelope', async () => {
	const { driver, cwd } = await setupClaude({ stdoutChunks: [event({ result: 'ENVELOPE-TEXT', is_error: false })] });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'ENVELOPE-TEXT', exitCode: 0, rateLimited: false, usage: undefined });
});

test('createClaudeCodeDriver: a result event split across two stdout chunks is still parsed', async () => {
	const { driver, cwd } = await setupClaude({ stdoutChunks: ['{"type":"result","res', 'ult":"SPLIT"}\n'], chunkDelay: true });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'SPLIT', exitCode: 0, rateLimited: false, usage: undefined });
});

test('createClaudeCodeDriver: an is_error result on a zero exit that names a usage limit is reported as rate limited', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [event({ type: 'result', result: 'Claude usage limit reached, resets at 5pm', is_error: true })],
	});

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'Claude usage limit reached, resets at 5pm', exitCode: 0, rateLimited: true, usage: undefined });
});

test('createClaudeCodeDriver: an ordinary failure keeps the raw stdout as text and is not misread as a rate limit', async () => {
	const { driver, cwd } = await setupClaude({ stdoutChunks: ['boom: unrecognized flag'], exitCode: 2 });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'boom: unrecognized flag', exitCode: 2, rateLimited: false, usage: undefined });
});

test('createClaudeCodeDriver: a harness that prints nothing falls back to stderr for the text', async () => {
	const { driver, cwd } = await setupClaude({ stderr: 'claude: rate limit exceeded', exitCode: 1 });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({ text: 'claude: rate limit exceeded', exitCode: 1, rateLimited: true, usage: undefined });
});

test('createClaudeCodeDriver: a hung harness is killed at the timeout, and the system prompt file still gets removed', async () => {
	const { driver, cwd, readArgv } = await setupClaude({ delaySeconds: 5 });

	await expect(driver.invoke({ prompt: 'TASK', systemPrompt: 'ROLE', cwd, timeoutMs: 400 })).rejects.toThrow(/claude timed out after 400ms/);

	const argv = await readArgv();
	const promptPath = argv[argv.indexOf('--append-system-prompt-file') + 1];

	// cleanup runs on the error path too
	expect(existsSync(promptPath)).toBe(false);
});

test('createClaudeCodeDriver: a harness that is not installed rejects with the spawn failure', async () => {
	const { driver, cwd } = await setupWithoutClaude();

	await expect(driver.invoke({ prompt: 'TASK', cwd })).rejects.toThrow(/ENOENT/);
});

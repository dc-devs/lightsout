import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from '@jest/globals';
import { Effort, Permissions } from '#src/contracts/index.ts';
import { createClaudeCodeDriver } from '#src/drivers/index.ts';
import { fakeHarnessOnPath } from '#tests/helpers/fakeHarnessOnPath.ts';

// What the engine asked for and what the process was actually handed: flags,
// the system-prompt file, stdin, and the two ways a spawn can end without ever
// producing a stream. How a stream is read is the sibling file's business.
const realPath = process.env.PATH ?? '';

afterAll(() => {
	process.env.PATH = realPath;
});

/** One scenario for the fake `claude`, less the two fields every claude scenario shares. */
type Scenario = Omit<Parameters<typeof fakeHarnessOnPath>[0], 'binary' | 'systemPromptFlag'>;

const setupClaude = async (scenario: Scenario = {}) => ({
	driver: createClaudeCodeDriver(),
	...(await fakeHarnessOnPath({ binary: 'claude', systemPromptFlag: '--append-system-prompt-file', ...scenario })),
});

/** A PATH holding no `claude` at all — the harness-not-installed scenario. */
const setupWithoutClaude = async () => {
	const dir = await mkdtemp(join(tmpdir(), 'lightsout-claude-missing-'));
	const binDir = join(dir, 'bin');

	await mkdir(binDir);

	process.env.PATH = binDir;

	return { driver: createClaudeCodeDriver(), cwd: dir };
};

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

test('createClaudeCodeDriver: a focused environment reaches the spawned process as flags', async () => {
	const { driver, cwd, readArgv } = await setupClaude();

	await driver.invoke({
		prompt: 'TASK',
		cwd,
		model: 'opus',
		effort: Effort.XHigh,
		permissions: Permissions.Write,
		allowedCommands: ['pnpm'],
		environment: { noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true, tools: ['Read', 'Grep', 'Edit'] },
	});

	// The isolation flags ride between the permission mode and the variadic
	// grant flag, and the allowlist is one comma-joined argument — a driver
	// that dropped the environment on the floor while destructuring the
	// invocation loses all three.
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
		'--strict-mcp-config',
		'--disable-slash-commands',
		'--tools',
		'Read,Grep,Edit',
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

test('createClaudeCodeDriver: a harness that exits without reading a large prompt yields its exit code, not a crashed engine', async () => {
	const { driver, cwd } = await setupClaude({ stdoutChunks: ['unknown option --nope'], exitCode: 2, readsStdin: false });

	// Larger than a pipe buffer, so the write still has bytes in flight when
	// the child is gone and EPIPE is raised on the stdin stream.
	const result = await driver.invoke({ prompt: 'x'.repeat(2 * 1024 * 1024), cwd });

	expect(result).toStrictEqual({ text: 'unknown option --nope', exitCode: 2, rateLimited: false, usage: undefined });
});

test('createClaudeCodeDriver: a hung harness is killed at the timeout, and the system prompt file still gets removed', async () => {
	const { driver, cwd, readArgv } = await setupClaude({ delaySeconds: 5 });

	// The timeout has to outlast process spawn on a loaded machine: the fake
	// harness records its argv before it hangs, and the assertions below read
	// that recording. Too tight a budget kills the shell before it writes.
	await expect(driver.invoke({ prompt: 'TASK', systemPrompt: 'ROLE', cwd, timeoutMs: 1500 })).rejects.toThrow(/claude timed out after 1500ms/);

	const argv = await readArgv();
	const promptPath = argv[argv.indexOf('--append-system-prompt-file') + 1];

	// cleanup runs on the error path too
	expect(existsSync(promptPath)).toBe(false);
});

test('createClaudeCodeDriver: a harness that is not installed rejects with the spawn failure', async () => {
	const { driver, cwd } = await setupWithoutClaude();

	await expect(driver.invoke({ prompt: 'TASK', cwd })).rejects.toThrow(/ENOENT/);
});

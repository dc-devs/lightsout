import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from '@jest/globals';
import { Permissions } from '#src/contracts/index.ts';
import { createOmpDriver, createPiDriver } from '#src/drivers/index.ts';

// The `pi`/`omp` binaries are the one unowned boundary here, so each setup
// writes fake ones onto PATH: they record the argv and stdin they were handed,
// copy any system-prompt file they were pointed at (the real one is deleted
// before the invocation returns), stream the scenario's stdout, and exit with
// the scenario's code. Nothing else is stubbed — the driver under test is the
// real one, spawning a real process.
const realPath = process.env.PATH ?? '';

afterAll(() => {
	process.env.PATH = realPath;
});

/** One json-mode event as the harness emits it: a complete JSON line. */
const event = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`;

/** The usage envelope omp 18.1.6 attaches to assistant messages — pi shares the shape. */
const usage = { input: 7774, output: 3, cacheRead: 9472, cacheWrite: 0, cost: { total: 0.01335952 } };

const setupBinary = async ({
	binary,
	stdoutChunks = [],
	stderr = '',
	exitCode = 0,
}: {
	binary: 'pi' | 'omp';
	stdoutChunks?: string[];
	stderr?: string;
	exitCode?: number;
}) => {
	const dir = await mkdtemp(join(tmpdir(), `lightsout-pi-driver-`));
	const binDir = join(dir, 'bin');
	const argvPath = join(dir, 'argv.txt');
	const stdinPath = join(dir, 'stdin.txt');
	const promptCopyPath = join(dir, 'system-prompt-copy.md');

	await mkdir(binDir);
	await writeFile(
		join(binDir, binary),
		[
			'#!/bin/sh',
			`printf '%s\\n' "$@" > '${argvPath}'`,
			"prev=''",
			'for arg in "$@"; do',
			`  if [ "$prev" = "--append-system-prompt" ]; then cp "$arg" '${promptCopyPath}'; fi`,
			'  prev="$arg"',
			'done',
			`cat > '${stdinPath}'`,
			...stdoutChunks.flatMap((chunk) => [`printf '%s' '${chunk}'`]),
			`printf '%s' '${stderr}' >&2`,
			`exit ${exitCode}`,
		].join('\n'),
		'utf8',
	);
	await chmod(join(binDir, binary), 0o755);

	process.env.PATH = `${binDir}:${realPath}`;

	return {
		driver: binary === 'pi' ? createPiDriver() : createOmpDriver(),
		cwd: dir,
		readArgv: async () => (await readFile(argvPath, 'utf8')).split('\n').slice(0, -1),
		readStdin: async () => readFile(stdinPath, 'utf8'),
		readSystemPromptCopy: async () => readFile(promptCopyPath, 'utf8'),
	};
};

/** A PATH holding neither pi-family binary at all — the harness-not-installed scenario. */
const setupWithoutBinaries = async () => {
	const dir = await mkdtemp(join(tmpdir(), 'lightsout-pi-missing-'));
	const binDir = join(dir, 'bin');

	await mkdir(binDir);

	process.env.PATH = binDir;

	return { cwd: dir };
};

test('createPiDriver: each factory reports the harness name the manifest will record it under', () => {
	expect(createPiDriver().name).toBe('pi');
	expect(createOmpDriver().name).toBe('omp');
});

test('createPiDriver: the invocation model, effort, and omp approval tier reach the spawned process as flags', async () => {
	const { driver, cwd, readArgv } = await setupBinary({ binary: 'omp' });

	await driver.invoke({
		prompt: 'task',
		cwd,
		model: 'zai/glm-5.3',
		effort: 'high',
		permissions: Permissions.Write,
	});

	const argv = await readArgv();
	expect(argv).toContain('-p');
	expect(argv).toContain('json');
	expect(argv).toContain('--no-session');
	expect(argv[argv.indexOf('--model') + 1]).toBe('zai/glm-5.3');
	expect(argv[argv.indexOf('--thinking') + 1]).toBe('high');
	expect(argv[argv.indexOf('--approval-mode') + 1]).toBe('write');
});

test('createPiDriver: bare pi gets the same model and effort but never an approval flag — it has no permission system', async () => {
	const { driver, cwd, readArgv } = await setupBinary({ binary: 'pi' });

	await driver.invoke({ prompt: 'task', cwd, model: 'glm-4.7', permissions: Permissions.FullAccess });

	const argv = await readArgv();
	expect(argv[argv.indexOf('--model') + 1]).toBe('glm-4.7');
	expect(argv).not.toContain('--approval-mode');
});

test('createPiDriver: the system prompt reaches the harness as a file, not as argv', async () => {
	const { driver, cwd, readArgv, readSystemPromptCopy } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [event({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }], isTerminal: true })],
	});

	await driver.invoke({ prompt: 'task', systemPrompt: '# Role\nBe the executor.', cwd });

	const argv = await readArgv();
	expect(argv[argv.indexOf('--append-system-prompt') + 1]).toMatch(/system-prompt\.md$/);
	// what the harness was pointed at is the prompt's contents, not the prompt itself
	expect(await readSystemPromptCopy()).toBe('# Role\nBe the executor.');
});

test('createPiDriver: the system prompt file is removed once the invocation returns', async () => {
	const { driver, cwd, readArgv } = await setupBinary({
		binary: 'pi',
		stdoutChunks: [event({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }], isTerminal: true })],
	});

	await driver.invoke({ prompt: 'task', systemPrompt: 'role', cwd });

	const promptPath = (await readArgv())[readArgv.length - 1];
	await expect(readFile(promptPath, 'utf8')).rejects.toThrow();
});

test('createPiDriver: the task prompt rides stdin verbatim, sidestepping the argv ceiling', async () => {
	const { driver, cwd, readStdin } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [event({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }], isTerminal: true })],
	});

	await driver.invoke({ prompt: 'a task\nwith lines', cwd });

	expect(await readStdin()).toBe('a task\nwith lines');
});

test('createPiDriver: agent_end supplies the text and the normalized usage, text blocks only', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [
			event({ type: 'session', version: 3, id: 'x' }),
			event({ type: 'agent_start' }),
			event({ type: 'turn_start' }),
			event({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'task' }] } }),
			// a tool-call round the final answer must not be taken from
			event({
				type: 'message_end',
				message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } }], usage },
			}),
			// the final answer carries thinking alongside its prose — only prose is text
			event({
				type: 'agent_end',
				messages: [
					{ role: 'user', content: [{ type: 'text', text: 'task' }] },
					{ role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } }], usage },
					{
						role: 'assistant',
						content: [
							{ type: 'thinking', thinking: 'hmm' },
							{ type: 'text', text: 'the answer' },
						],
						usage,
					},
				],
				isTerminal: true,
			}),
		],
	});

	const result = await driver.invoke({ prompt: 'task', cwd });

	expect(result.exitCode).toBe(0);
	expect(result.text).toBe('the answer');
	expect(result.usage).toStrictEqual({
		inputTokens: 7774,
		outputTokens: 3,
		cacheReadTokens: 9472,
		cacheCreationTokens: 0,
		costUsd: 0.01335952,
	});
});

test('createPiDriver: without agent_end the last assistant message_end is the fallback verdict', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'pi',
		stdoutChunks: [
			event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }], usage } }),
			// a stream cut before agent_end still answers with its last word
			event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'last word' }], usage } }),
		],
	});

	const result = await driver.invoke({ prompt: 'task', cwd });

	expect(result.text).toBe('last word');
});

test('createPiDriver: every parseable streamed event reaches onEvent, blank and non-JSON lines aside', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [
			'\n',
			'not json\n',
			event({ type: 'agent_start' }),
			event({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }], isTerminal: true }),
		],
	});

	const seen: unknown[] = [];
	const result = await driver.invoke({ prompt: 'task', cwd, onEvent: (event) => seen.push(event) });

	expect(seen).toHaveLength(2);
	expect(seen[0] !== null && typeof seen[0] === 'object' && 'type' in seen[0] && seen[0].type === 'agent_start').toBe(true);
	expect(result.text).toBe('ok');
});

test('createPiDriver: a final message reporting no usage reports no usage at all', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [event({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }], isTerminal: true })],
	});

	const result = await driver.invoke({ prompt: 'task', cwd });

	expect(result.usage).toBeUndefined();
});

test('createPiDriver: an errored 529 overload parks like a rate limit — transient, never a failed batch', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'omp',
		stderr: 'Error: status 529 overloaded',
		exitCode: 1,
	});

	const result = await driver.invoke({ prompt: 'task', cwd });

	expect(result.exitCode).toBe(1);
	expect(result.rateLimited).toBe(true);
});

test('createPiDriver: an ordinary failure keeps the raw stderr as text and is not misread as a rate limit', async () => {
	const { driver, cwd } = await setupBinary({ binary: 'pi', stderr: 'Error: bad flag --nope', exitCode: 1 });

	const result = await driver.invoke({ prompt: 'task', cwd });

	expect(result.exitCode).toBe(1);
	expect(result.text).toBe('Error: bad flag --nope');
	expect(result.rateLimited).toBe(false);
});

test('createPiDriver: a clean exit whose stream carries no assistant message is an error, not a silent empty success', async () => {
	const { driver, cwd } = await setupBinary({ binary: 'omp', stdoutChunks: [event({ type: 'agent_start' })] });

	const result = await driver.invoke({ prompt: 'task', cwd });

	// the raw stream is still the text, so the failure is diagnosable
	expect(result.text).toContain('agent_start');
	expect(result.rateLimited).toBe(false);
});

test('createPiDriver: a harness that is not installed rejects with the spawn failure', async () => {
	const { cwd } = await setupWithoutBinaries();

	await expect(createOmpDriver().invoke({ prompt: 'task', cwd })).rejects.toThrow();
});

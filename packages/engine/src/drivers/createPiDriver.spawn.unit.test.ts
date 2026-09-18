import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from '@jest/globals';
import { Permissions } from '#src/contracts/index.ts';
import { createOmpDriver, createPiDriver } from '#src/drivers/index.ts';
import { fakeHarnessOnPath } from '#tests/helpers/fakeHarnessOnPath.ts';

// What the engine asked for and what the process was actually handed: the
// harness names, the flags, the system-prompt file, stdin, and a PATH holding
// neither binary. How a stream is read is the sibling file's business.
const realPath = process.env.PATH ?? '';

afterAll(() => {
	process.env.PATH = realPath;
});

/** One json-mode event as the harness emits it: a complete JSON line. */
const event = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`;

/** One scenario for a fake pi-family binary, whose name also picks the driver under test. */
type Scenario = Omit<Parameters<typeof fakeHarnessOnPath>[0], 'binary' | 'systemPromptFlag'> & { binary: 'pi' | 'omp' };

const setupBinary = async ({ binary, ...scenario }: Scenario) => ({
	driver: binary === 'pi' ? createPiDriver() : createOmpDriver(),
	...(await fakeHarnessOnPath({ binary, systemPromptFlag: '--append-system-prompt', ...scenario })),
});

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

test('createPiDriver: a harness that is not installed rejects with the spawn failure', async () => {
	const { cwd } = await setupWithoutBinaries();

	await expect(createOmpDriver().invoke({ prompt: 'task', cwd })).rejects.toThrow();
});

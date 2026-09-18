import { afterAll, expect, test } from '@jest/globals';
import type { HarnessProcessUsage } from '#src/contracts/index.ts';
import { createOmpDriver, createPiDriver } from '#src/drivers/index.ts';
import { fakeHarnessOnPath } from '#tests/helpers/fakeHarnessOnPath.ts';

// How the driver reads a stream: the answer it takes from it, the events it
// relays, and the session spend it adds up message by message. What the spawned
// process was handed is the sibling `.spawn.` file's business.
const realPath = process.env.PATH ?? '';

afterAll(() => {
	process.env.PATH = realPath;
});

/** One json-mode event as the harness emits it: a complete JSON line. */
const event = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`;

/** The usage envelope omp 18.1.6 attaches to assistant messages — pi shares the shape. */
const usage = { input: 7774, output: 3, cacheRead: 9472, cacheWrite: 0, cost: { total: 0.01335952 } };

/** One scenario for a fake pi-family binary, whose name also picks the driver under test. */
type Scenario = Omit<Parameters<typeof fakeHarnessOnPath>[0], 'binary' | 'systemPromptFlag'> & { binary: 'pi' | 'omp' };

const setupBinary = async ({ binary, ...scenario }: Scenario) => ({
	driver: binary === 'pi' ? createPiDriver() : createOmpDriver(),
	...(await fakeHarnessOnPath({ binary, systemPromptFlag: '--append-system-prompt', ...scenario })),
});

/**
 * Three assistant turns of one real multi-turn omp session, captured by hand
 * from the installed omp 18.1.6 binary and trimmed to the counts this driver
 * reads. The capture settles what `cost.total` means: on the second turn omp
 * states input 0.0019968, output 0.000058 and cacheRead 0.00020736, which add
 * to that same turn's total of 0.00226216 — so `total` is one message's spend
 * and never a running one. The per-turn `input` counts fall as the context
 * moves into the cache, so the last turn's counts are nowhere near the
 * session's.
 */
const capturedTurns = [
	{ input: 18073, output: 122, cacheRead: 0, cacheWrite: 0, cost: { total: 0.0027719499999999996 } },
	{ input: 13312, output: 116, cacheRead: 6912, cacheWrite: 0, cost: { total: 0.00226216 } },
	{ input: 6690, output: 134, cacheRead: 20224, cacheWrite: 0, cost: { total: 0.00167722 } },
];

/** One captured turn as the stream carries it: an assistant message with prose and its own usage. */
const capturedTurn = ({ index, text }: { index: number; text: string }) => ({
	role: 'assistant',
	content: [{ type: 'text', text }],
	usage: capturedTurns[index],
});

/** The whole captured session as omp streams it: a `message_end` per turn, then `agent_end` restating every message. */
const setupCapturedSession = () =>
	setupBinary({
		binary: 'omp',
		stdoutChunks: [
			event({ type: 'message_end', message: capturedTurn({ index: 0, text: 'reading the docs' }) }),
			event({ type: 'message_end', message: capturedTurn({ index: 1, text: 'reading two more' }) }),
			event({
				type: 'agent_end',
				messages: [
					{ role: 'user', content: [{ type: 'text', text: 'task' }] },
					capturedTurn({ index: 0, text: 'reading the docs' }),
					capturedTurn({ index: 1, text: 'reading two more' }),
					capturedTurn({ index: 2, text: 'the answer' }),
				],
				isTerminal: true,
			}),
		],
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
	// Two assistant messages carried usage — the tool-call round and the final
	// answer — so the process spent both, and the repeat of the tool-call round
	// inside agent_end adds nothing a second time.
	expect(result.usage).toStrictEqual({
		inputTokens: 15548,
		outputTokens: 6,
		cacheReadTokens: 18944,
		cacheCreationTokens: 0,
		costUsd: 0.02671904,
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

test('createPiDriver: a message stating only some of its counts contributes those and nothing invented for the rest', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [
			// this harness omits a count it has nothing to say about — no cache
			// figures and no cost on a first uncached turn
			event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input: 10 } } }),
		],
	});

	const result = await driver.invoke({ prompt: 'task', cwd });

	expect(result.usage).toStrictEqual({ inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 });
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

test("createPiDriver: a multi-turn session reports the whole process's tokens, not the last message's", async () => {
	const { driver, cwd } = await setupCapturedSession();

	const result = await driver.invoke({ prompt: 'task', cwd });

	// 18073 + 13312 + 6690 input, not the final turn's 6690 alone
	expect(result.usage).toEqual(expect.objectContaining({ inputTokens: 38075, outputTokens: 372, cacheReadTokens: 27136, cacheCreationTokens: 0 }));
});

test("createPiDriver: the reported cost is the session's, as the captured transcript states it", async () => {
	const { driver, cwd } = await setupCapturedSession();

	const result = await driver.invoke({ prompt: 'task', cwd });

	// 0.00277195 + 0.00226216 + 0.00167722 — three per-message totals added up
	expect(result.usage?.costUsd).toBeCloseTo(0.00671133, 8);
});

test('createPiDriver: usage streams per message so a stream that never ends still reports', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [
			event({ type: 'message_end', message: capturedTurn({ index: 0, text: 'reading the docs' }) }),
			event({ type: 'message_end', message: capturedTurn({ index: 1, text: 'reading two more' }) }),
		],
	});

	const reported: HarnessProcessUsage[] = [];
	await driver.invoke({ prompt: 'task', cwd, onUsage: (streamed) => reported.push(streamed) });

	const last = reported.at(-1);
	expect(last).toEqual(expect.objectContaining({ inputTokens: 31385, outputTokens: 238, cacheReadTokens: 6912, cacheCreationTokens: 0 }));
	expect(last?.costUsd).toBeCloseTo(0.00503411, 8);
});

test('createPiDriver: a message carried by both message_end and agent_end is counted once', async () => {
	const { driver, cwd } = await setupBinary({
		binary: 'omp',
		stdoutChunks: [
			event({ type: 'message_end', message: capturedTurn({ index: 0, text: 'reading the docs' }) }),
			event({
				type: 'agent_end',
				messages: [capturedTurn({ index: 0, text: 'reading the docs' }), capturedTurn({ index: 1, text: 'the answer' })],
				isTerminal: true,
			}),
		],
	});

	const result = await driver.invoke({ prompt: 'task', cwd });

	// the repeated first turn adds 18073 once, so the total is 31385 and never 49458
	expect(result.usage).toEqual(expect.objectContaining({ inputTokens: 31385, outputTokens: 238, cacheReadTokens: 6912, cacheCreationTokens: 0 }));
});

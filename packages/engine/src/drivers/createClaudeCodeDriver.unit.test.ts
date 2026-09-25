import { afterAll, expect, test } from '@jest/globals';
import type { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';
import { createClaudeCodeDriver } from '#src/drivers/createClaudeCodeDriver.ts';
import { fakeHarnessOnPath } from '#tests/helpers/fakeHarnessOnPath.ts';

// How the driver reads a stream: the verdict it reaches, the events it relays,
// and the usage it reports as the process runs and once it ends. What the
// spawned process was handed is the sibling `.spawn.` file's business.
const realPath = process.env.PATH ?? '';

afterAll(() => {
	process.env.PATH = realPath;
});

/** One stream-json event as the harness emits it: a complete JSON line. */
const event = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`;

/** One scenario for the fake `claude`, less the two fields every claude scenario shares. */
type Scenario = Omit<Parameters<typeof fakeHarnessOnPath>[0], 'binary' | 'systemPromptFlag'>;

const setupClaude = async (scenario: Scenario = {}) => ({
	driver: createClaudeCodeDriver(),
	...(await fakeHarnessOnPath({ binary: 'claude', systemPromptFlag: '--append-system-prompt-file', ...scenario })),
});

/**
 * One streamed `assistant` event. The harness emits the same message once per
 * content block, so `id` is what tells a repeat from a new message, and its
 * `output_tokens` is a placeholder the driver must never report as a count.
 */
const assistantEvent = ({ id, input, cacheRead, cacheCreation }: { id: string; input: number; cacheRead: number; cacheCreation: number }) =>
	event({
		type: 'assistant',
		message: { id, usage: { input_tokens: input, output_tokens: 2, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation } },
	});

test('createClaudeCodeDriver: the driver reports the harness name the manifest records it under', () => {
	const driver = createClaudeCodeDriver();

	expect(driver.name).toBe('claude-code');
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
		stdoutChunks: [`${event({ type: 'assistant', text: 'thinking' })}\nnot json at all\n${event({ type: 'result', result: 'FINAL' })}`],
	});
	const seen: unknown[] = [];

	await driver.invoke({ prompt: 'TASK', cwd, onEvent: (streamed) => seen.push(streamed) });

	expect(seen).toStrictEqual([
		{ type: 'assistant', text: 'thinking' },
		{ type: 'result', result: 'FINAL' },
	]);
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

test('createClaudeCodeDriver: a result event carrying only token counts reports them with a zeroed cost', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [event({ type: 'result', result: 'FINAL', usage: { input_tokens: 7, output_tokens: 9 } })],
	});

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result).toStrictEqual({
		text: 'FINAL',
		exitCode: 0,
		rateLimited: false,
		// a harness that reports tokens but no price is recorded at zero cost,
		// never dropped for want of the one field it left out
		usage: { inputTokens: 7, outputTokens: 9, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
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

test('createClaudeCodeDriver: the period-qualified wording the harness really uses is reported as a wall', async () => {
	// The exact rejected payload from the 2026-08-25 graded pass, which the two
	// hand-written driver patterns both missed.
	const walled = "You've hit your weekly limit · resets 4am";
	// The apostrophe is escaped for the single-quoted `printf` inside the fake
	// harness script; the text the driver sees is the original.
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [event({ type: 'result', result: walled, is_error: true }).replaceAll("'", String.raw`'\''`)],
	});

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result.text).toBe(walled);
	expect(result.rateLimited).toBe(true);
});

test('createClaudeCodeDriver: an errored 529 overload parks like a rate limit — transient, never a failed batch', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [event({ type: 'result', result: 'API Error: 529 Overloaded. This is a server-side issue, usually temporary', is_error: true })],
	});

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result.rateLimited).toBe(true);
});

test('createClaudeCodeDriver: a failure whose text merely contains the digits 529 is not parked as an overload', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [event({ type: 'result', result: 'src/report.ts:529 — cannot find name `total` (1529 tokens used)', is_error: true })],
	});

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result.rateLimited).toBe(false);
});

test('createClaudeCodeDriver: agent text mentioning an overload on a clean exit is never misread as one', async () => {
	const { driver, cwd } = await setupClaude({ stdoutChunks: [event({ type: 'result', result: 'the queue was overloaded, so I added backpressure' })] });

	const result = await driver.invoke({ prompt: 'TASK', cwd });

	expect(result.rateLimited).toBe(false);
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

test('createClaudeCodeDriver: an assistant message repeated per content block is counted once', async () => {
	const block = assistantEvent({ id: 'msg_01', input: 100, cacheRead: 200, cacheCreation: 300 });
	const { driver, cwd } = await setupClaude({ stdoutChunks: [block + block] });
	const reported: HarnessProcessUsage[] = [];

	await driver.invoke({ prompt: 'TASK', cwd, onUsage: (usage) => reported.push(usage) });

	// the one message's own counts, not twice them
	expect(reported.at(-1)).toEqual({ inputTokens: 100, cacheReadTokens: 200, cacheCreationTokens: 300 });
});

test('createClaudeCodeDriver: streamed usage reports the input side and leaves output and cost unreported', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [
			assistantEvent({ id: 'msg_01', input: 10, cacheRead: 20, cacheCreation: 30 }) +
				assistantEvent({ id: 'msg_02', input: 5, cacheRead: 6, cacheCreation: 7 }),
		],
	});
	const reported: HarnessProcessUsage[] = [];

	await driver.invoke({ prompt: 'TASK', cwd, onUsage: (usage) => reported.push(usage) });

	// output tokens and cost are absent, never zero and never the streamed
	// placeholder — the harness knows neither until its terminal event
	expect(reported.at(-1)).toEqual({ inputTokens: 15, cacheReadTokens: 26, cacheCreationTokens: 37 });
});

test('createClaudeCodeDriver: the terminal result event supersedes the streamed accumulation', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [
			assistantEvent({ id: 'msg_01', input: 10, cacheRead: 20, cacheCreation: 30 }) +
				event({
					type: 'result',
					result: 'FINAL',
					usage: { input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 5600, cache_creation_input_tokens: 7800 },
					total_cost_usd: 0.42,
				}),
		],
	});
	const reported: HarnessProcessUsage[] = [];

	const result = await driver.invoke({ prompt: 'TASK', cwd, onUsage: (usage) => reported.push(usage) });

	expect(reported.at(-1)).toEqual({ inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 5600, cacheCreationTokens: 7800, costUsd: 0.42 });
	expect(result.usage).toStrictEqual({ inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 5600, cacheCreationTokens: 7800, costUsd: 0.42 });
});

test('createClaudeCodeDriver: an assistant message stating no usage reports nothing and leaves the running total alone', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [event({ type: 'assistant', message: { id: 'msg_01' } }) + assistantEvent({ id: 'msg_02', input: 10, cacheRead: 20, cacheCreation: 30 })],
	});
	const reported: HarnessProcessUsage[] = [];

	await driver.invoke({ prompt: 'TASK', cwd, onUsage: (usage) => reported.push(usage) });

	// the silent message produces no payload at all, and the message after it
	// still reports its own counts rather than inheriting a zero
	expect(reported).toStrictEqual([{ inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 30 }]);
});

test('createClaudeCodeDriver: a streamed message stating only some counts contributes the ones it stated', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [
			event({ type: 'assistant', message: { id: 'msg_01', usage: { input_tokens: 40 } } }) +
				event({ type: 'assistant', message: { id: 'msg_02', usage: { cache_read_input_tokens: 9 } } }),
		],
	});
	const reported: HarnessProcessUsage[] = [];

	await driver.invoke({ prompt: 'TASK', cwd, onUsage: (usage) => reported.push(usage) });

	expect(reported.at(-1)).toStrictEqual({ inputTokens: 40, cacheReadTokens: 9, cacheCreationTokens: 0 });
});

test('createClaudeCodeDriver: streamed counts never become the returned usage when the result event states none', async () => {
	const { driver, cwd } = await setupClaude({
		stdoutChunks: [assistantEvent({ id: 'msg_01', input: 10, cacheRead: 20, cacheCreation: 30 }) + event({ type: 'result', result: 'FINAL' })],
	});
	const reported: HarnessProcessUsage[] = [];

	const result = await driver.invoke({ prompt: 'TASK', cwd, onUsage: (usage) => reported.push(usage) });

	// what the process reported while it ran is evidence for the record; the
	// returned usage is still only what the terminal envelope stated
	expect(reported.at(-1)).toStrictEqual({ inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 30 });
	expect(result).toStrictEqual({ text: 'FINAL', exitCode: 0, rateLimited: false, usage: undefined });
});

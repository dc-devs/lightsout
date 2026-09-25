import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { checkHarnessUsage } from '#src/doctor/checkHarnessUsage.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import type { DriverResult } from '#src/drivers/common/types/DriverResult.ts';

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** The shape Claude Code really streams: usage hangs off the assistant message, not off the event root. */
const streamedUsageEvent = { type: 'assistant', message: { usage: { input_tokens: 812, output_tokens: 173 } } };

const streamedSilentEvent = { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } };

interface SetupParams {
	/** The global harness the config names. Omitted leaves the claude-code default in place. */
	harness?: string;
	/** What the settled call reports. Omitted is a harness that reported nothing at all. */
	usage?: DriverResult['usage'];
	/** Raw events handed to `onEvent` as the call streams. */
	events?: unknown[];
	/** A spawn that rejects, as one killed at its ceiling does. */
	error?: Error;
}

/**
 * A config plus a stub driver that records every invocation it is handed — the
 * seam is the whole reason this check can be tested at all, since a real probe
 * spends money on the user's own subscription.
 */
const setupProbe = ({ harness, usage, events = [], error }: SetupParams = {}) => {
	const invocations: DriverInvocation[] = [];

	const driver: Driver = {
		name: harness ?? 'claude-code',
		invoke: async (invocation: DriverInvocation): Promise<DriverResult> => {
			invocations.push(invocation);

			if (error) {
				throw error;
			}

			for (const event of events) {
				invocation.onEvent?.(event);
			}

			return { text: 'ok', exitCode: 0, usage };
		},
	};

	const config: LightsoutConfig = { gates, harness };

	return { config, driver, invocations };
};

describe('checkHarnessUsage', () => {
	test('a codex harness is noted as out of scope and never spawned', async () => {
		const { config, driver, invocations } = setupProbe({
			harness: 'codex',
			usage: { inputTokens: 812, outputTokens: 173, cacheReadTokens: 9, cacheCreationTokens: 4, costUsd: 0.03 },
		});

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		// codex reads no usage by design, so probing it would spend real money to
		// rediscover a known answer
		expect(check).toEqual(expect.objectContaining({ id: 'harness-usage', status: 'note', detail: expect.stringMatching(/codex/i) }));
		expect(invocations).toStrictEqual([]);
	});

	test('a harness reporting both settled and streamed token counts passes and names them', async () => {
		const { config, driver } = setupProbe({
			usage: { inputTokens: 812, outputTokens: 173, cacheReadTokens: 9, cacheCreationTokens: 4, costUsd: 0.03 },
			events: [streamedUsageEvent],
		});

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		expect(check.status).toBe('pass');
		expect(check.detail).toMatch(/claude-code/);
		// the counts it read are named, so a reader can tell a real reading from a
		// zero the check invented
		expect(check.detail).toMatch(/812/);
		expect(check.detail).toMatch(/173/);
	});

	test('a harness that reports only at the end warns that a killed process would recover nothing', async () => {
		const { config, driver } = setupProbe({
			usage: { inputTokens: 812, outputTokens: 173, cacheReadTokens: 9, cacheCreationTokens: 4, costUsd: 0.03 },
			events: [streamedSilentEvent],
		});

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		// a settled call that reports fine still leaves a timed-out spawn with
		// nothing to recover, which is a warning rather than a pass
		expect(check.status).toBe('warn');
		expect(check.fix ?? '').toMatch(/stream/i);
	});

	test('a harness reporting no usage at all fails and names the adapter to re-capture', async () => {
		const { config, driver } = setupProbe({ events: [streamedSilentEvent] });

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		expect(check.status).toBe('fail');
		// renamed token fields read exactly like a call that spent nothing, so the
		// fix has to name the adapter file whose parse went stale
		expect(check.fix ?? '').toMatch(/createClaudeCodeDriver/);
	});

	test('a driver that throws is recorded as a failed check, not an escaping error', async () => {
		const { config, driver } = setupProbe({ error: new Error('harness timed out after 120000ms') });

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		expect(check.status).toBe('fail');
		expect(check.detail).toMatch(/harness timed out after 120000ms/);
	});

	test('the probe spends exactly one read-only, time-limited call', async () => {
		const { config, driver, invocations } = setupProbe({
			usage: { inputTokens: 812, outputTokens: 173, cacheReadTokens: 9, cacheCreationTokens: 4, costUsd: 0.03 },
			events: [streamedUsageEvent],
		});

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		expect(check.status).toBe('pass');
		// one spawn, no retry ladder — every extra call is more of the user's own
		// subscription than the answer is worth
		expect(invocations).toHaveLength(1);
		expect(invocations[0]).toEqual(expect.objectContaining({ cwd: '/repo', permissions: 'read-only', timeoutMs: expect.any(Number) }));
	});

	test('a pi-family harness that streams no token counts names the pi adapter, not the claude-code one', async () => {
		const { config, driver } = setupProbe({
			harness: 'omp',
			usage: { inputTokens: 44, outputTokens: 12, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.001 },
			events: [streamedSilentEvent],
		});

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		// omp and pi share one adapter, so the fix has to send the reader to the
		// file that really holds the stale parse
		expect(check.status).toBe('warn');
		expect(check.fix ?? '').toMatch(/createPiDriver/);
	});

	test('a harness the engine has no adapter row for still names something to look at', async () => {
		const { config, driver } = setupProbe({ harness: 'toolbox', events: [streamedSilentEvent] });

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		expect(check.status).toBe('fail');
		// an unknown harness never leaves the reader a fix pointing at `undefined`
		expect(check.fix ?? '').toContain('the toolbox driver');
	});

	test("a failed probe names that harness's own version command, not claude's", async () => {
		const { config, driver } = setupProbe({ harness: 'pi', error: new Error('spawn pi ENOENT') });

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		expect(check.status).toBe('fail');
		// only claude-code is invoked under another name — every other harness is
		// its own command, and naming `claude` there would be a dead end
		expect(check.fix ?? '').toContain('pi --version');
	});

	test('a harness with no driver seam and no registry entry fails without spawning anything', async () => {
		const { config } = setupProbe({ harness: 'toolbox' });

		const check = await checkHarnessUsage({ cwd: '/repo', config });

		// the seam defaults to the real registry, and a name it does not hold is
		// refused there — a throw on the way to the spawn is still a recorded check
		expect(check.status).toBe('fail');
		expect(check.detail).toMatch(/unknown driver: toolbox/);
	});

	test.each([
		{ shape: 'a usage member holding no finite number', event: { type: 'assistant', message: { usage: { input_tokens: Number.NaN } } } },
		{ shape: 'a usage member that is not an object at all', event: { type: 'assistant', usage: 'high' } },
		{
			shape: 'token counts nested deeper than the walk goes',
			event: { a: { b: { c: { d: { e: { f: { g: { usage: { input_tokens: 812 } } } } } } } } },
		},
		{ shape: 'an event that is not an object', event: 'raw stdout line' },
	])('$shape is not counted as streamed token counts', async ({ event }) => {
		const { config, driver } = setupProbe({
			usage: { inputTokens: 812, outputTokens: 173, cacheReadTokens: 9, cacheCreationTokens: 4, costUsd: 0.03 },
			events: [event],
		});

		const check = await checkHarnessUsage({ cwd: '/repo', config, driver });

		// the streamed reading is what a killed process falls back on, so a shape
		// carrying no readable count has to read as silence, never as a reading
		expect(check.status).toBe('warn');
	});
});

import { describe, expect, jest, test } from '@jest/globals';
import { createAgentHeartbeat } from '#src/standardsCheck/common/utils/createAgentHeartbeat.ts';

/** A Claude Code stream-json assistant event carrying the given content blocks. */
const assistantEvent = ({ blocks }: { blocks: string[] }) => ({ type: 'assistant', message: { content: blocks.map((type) => ({ type })) } });

/** A heartbeat on a clock that starts at zero, with every line it prints captured. */
const setupHeartbeat = ({ intervalMs }: { intervalMs?: number } = {}) => {
	jest.useFakeTimers({ now: 0 });

	const progress: string[] = [];
	const heartbeat = createAgentHeartbeat({ onProgress: (message) => progress.push(message), intervalMs });

	return { heartbeat, progress };
};

describe('createAgentHeartbeat', () => {
	test('says nothing until the first interval has passed — a fast agent is not narrated', () => {
		const { heartbeat, progress } = setupHeartbeat();

		jest.advanceTimersByTime(29_999);
		heartbeat.stop();

		expect(progress).toStrictEqual([]);
	});

	test('prints one elapsed line per interval, by default every 30s', () => {
		const { progress } = setupHeartbeat();

		jest.advanceTimersByTime(90_000);

		expect(progress).toStrictEqual(['still working — 30s elapsed', 'still working — 1m00s elapsed', 'still working — 1m30s elapsed']);
	});

	test('the interval is the caller’s to set', () => {
		const { progress } = setupHeartbeat({ intervalMs: 10_000 });

		jest.advanceTimersByTime(20_000);

		expect(progress).toStrictEqual(['still working — 10s elapsed', 'still working — 20s elapsed']);
	});

	test('counts tool calls off the harness event stream as evidence the agent is working', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent(assistantEvent({ blocks: ['text', 'tool_use'] }));
		heartbeat.onEvent(assistantEvent({ blocks: ['tool_use', 'tool_use'] }));
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['still working — 30s elapsed · 3 tool call(s) so far']);
	});

	test('an event that is not a tool call still shows the harness is streaming — zero calls, not silence', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent({ type: 'system', subtype: 'init' });
		heartbeat.onEvent('not even json-shaped');
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['still working — 30s elapsed · 0 tool call(s) so far']);
	});

	test('the count accumulates across lines, so a later line shows the whole run', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent(assistantEvent({ blocks: ['tool_use'] }));
		jest.advanceTimersByTime(30_000);
		heartbeat.onEvent(assistantEvent({ blocks: ['tool_use'] }));
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['still working — 30s elapsed · 1 tool call(s) so far', 'still working — 1m00s elapsed · 2 tool call(s) so far']);
	});

	test('stop ends the ticker — no line is printed after it', () => {
		const { heartbeat, progress } = setupHeartbeat();

		jest.advanceTimersByTime(30_000);
		heartbeat.stop();
		jest.advanceTimersByTime(120_000);

		expect(progress).toStrictEqual(['still working — 30s elapsed']);
	});

	test('elapsed time is read off the clock while running, and frozen once stopped', () => {
		const { heartbeat } = setupHeartbeat();

		jest.advanceTimersByTime(12_000);
		const running = heartbeat.elapsedMs();
		heartbeat.stop();
		jest.advanceTimersByTime(50_000);

		expect(running).toBe(12_000);
		expect(heartbeat.elapsedMs()).toBe(12_000);
	});

	test('a second stop is harmless and keeps the first stop’s time', () => {
		const { heartbeat } = setupHeartbeat();

		jest.advanceTimersByTime(5_000);
		heartbeat.stop();
		jest.advanceTimersByTime(5_000);
		heartbeat.stop();

		expect(heartbeat.elapsedMs()).toBe(5_000);
	});
});

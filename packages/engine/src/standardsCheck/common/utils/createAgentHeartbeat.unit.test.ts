import { describe, expect, jest, test } from '@jest/globals';
import { createAgentHeartbeat } from '#src/standardsCheck/common/utils/createAgentHeartbeat.ts';

/** A Claude Code stream-json assistant event carrying one tool call per entry: the tool's name and, for a Read, the file it opened. */
const toolUseEvent = ({ calls }: { calls: { name: string; path?: string }[] }) => ({
	type: 'assistant',
	message: { content: calls.map(({ name, path }) => ({ type: 'tool_use', name, input: path === undefined ? {} : { file_path: path } })) },
});

/** A heartbeat on a clock that starts at zero, with every line it prints captured. */
const setupHeartbeat = ({ intervalMs }: { intervalMs?: number } = {}) => {
	jest.useFakeTimers({ now: 0 });

	const progress: string[] = [];
	const heartbeat = createAgentHeartbeat({ label: 'agent review', onProgress: (message) => progress.push(message), intervalMs });

	return { heartbeat, progress };
};

describe('createAgentHeartbeat', () => {
	test('says nothing until the first interval has passed — a fast agent is not narrated', () => {
		const { heartbeat, progress } = setupHeartbeat();

		jest.advanceTimersByTime(29_999);
		heartbeat.stop();

		expect(progress).toStrictEqual([]);
	});

	test('prints one "still running" line per interval, by default every 30s, each naming the work and how long it has run', () => {
		const { progress } = setupHeartbeat();

		jest.advanceTimersByTime(90_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 30s', '⏳ agent review still running · 1m00s', '⏳ agent review still running · 1m30s']);
	});

	test('the interval is the caller’s to set', () => {
		const { progress } = setupHeartbeat({ intervalMs: 10_000 });

		jest.advanceTimersByTime(20_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 10s', '⏳ agent review still running · 20s']);
	});

	test('counts the files the agent has read off the harness event stream — proof of life in the reader’s own words', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent(toolUseEvent({ calls: [{ name: 'Read', path: 'src/a.ts' }] }));
		heartbeat.onEvent(
			toolUseEvent({
				calls: [
					{ name: 'Read', path: 'src/b.ts' },
					{ name: 'Read', path: 'src/c.ts' },
				],
			}),
		);
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 30s · 3 files read so far']);
	});

	test('one file reads as one file, however it is phrased', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent(toolUseEvent({ calls: [{ name: 'Read', path: 'src/a.ts' }] }));
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 30s · 1 file read so far']);
	});

	test('a file opened twice is one file read — the count is files, not calls', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent(toolUseEvent({ calls: [{ name: 'Read', path: 'src/a.ts' }] }));
		heartbeat.onEvent(toolUseEvent({ calls: [{ name: 'Read', path: 'src/a.ts' }] }));
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 30s · 1 file read so far']);
	});

	test('tool calls that open no file, and events that are not tool calls, add nothing to the count', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent(toolUseEvent({ calls: [{ name: 'Grep' }, { name: 'Read' }] }));
		heartbeat.onEvent({ type: 'system', subtype: 'init' });
		heartbeat.onEvent('not even json-shaped');
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 30s']);
	});

	test('the count accumulates across lines, so a later line shows the whole run', () => {
		const { heartbeat, progress } = setupHeartbeat();

		heartbeat.onEvent(toolUseEvent({ calls: [{ name: 'Read', path: 'src/a.ts' }] }));
		jest.advanceTimersByTime(30_000);
		heartbeat.onEvent(toolUseEvent({ calls: [{ name: 'Read', path: 'src/b.ts' }] }));
		jest.advanceTimersByTime(30_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 30s · 1 file read so far', '⏳ agent review still running · 1m00s · 2 files read so far']);
	});

	test('stop ends the ticker — no line is printed after it', () => {
		const { heartbeat, progress } = setupHeartbeat();

		jest.advanceTimersByTime(30_000);
		heartbeat.stop();
		jest.advanceTimersByTime(120_000);

		expect(progress).toStrictEqual(['⏳ agent review still running · 30s']);
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

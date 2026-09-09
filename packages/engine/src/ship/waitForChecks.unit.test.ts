import { describe, expect, jest, test } from '@jest/globals';
import { type ChecksSummary, readPullRequestChecks } from '#src/ship/forge/index.ts';
import { waitForChecks } from '#src/ship/waitForChecks.ts';

// The forge is mocked rather than stubbed on PATH: this unit is about waiting,
// and the waits are half an hour long. Fake timers make them instant, and a
// real child process under fake timers would be killed by its own deadline
// rather than answering.
jest.mock('#src/ship/forge/index.ts', () => ({ readPullRequestChecks: jest.fn<typeof readPullRequestChecks>() }));

const mockReadPullRequestChecks = jest.mocked(readPullRequestChecks);

const green: ChecksSummary = { finished: true, green: true, failing: [], pending: [], passing: ['unit'], readable: true };
const running: ChecksSummary = { finished: false, green: true, failing: [], pending: ['e2e'], passing: ['unit'], readable: true };
const empty: ChecksSummary = { finished: true, green: true, failing: [], pending: [], passing: [], readable: true };
const red: ChecksSummary = { finished: true, green: false, failing: ['unit'], pending: [], passing: [], readable: true };

/** A forge answering these polls in order, then repeating the last one for as long as it is asked. */
const setupPolls = ({ polls }: { polls: (ChecksSummary | undefined)[] }) => {
	const queue = [...polls];
	const progress: string[] = [];

	jest.useFakeTimers();
	mockReadPullRequestChecks.mockImplementation(() => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0]));

	return { progress, onProgress: (message: string) => progress.push(message) };
};

describe('waitForChecks', () => {
	test('checks already green settle on the first poll, so nothing waits for a pull request that is ready', async () => {
		const { progress, onProgress } = setupPolls({ polls: [green] });

		const summary = await waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi: false, onProgress });

		expect(summary).toStrictEqual(green);
		expect(progress).toStrictEqual(['checks: 1 passed, 0 running, 0 failed']);
	});

	test('a check still running is waited on, and the settled answer is what comes back', async () => {
		const { onProgress } = setupPolls({ polls: [running, green] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi: false, onProgress });
		await jest.advanceTimersByTimeAsync(60_000);

		await expect(waiting).resolves.toStrictEqual(green);
	});

	test('an empty check list is polled through a grace window before it counts as no CI at all', async () => {
		const { onProgress } = setupPolls({ polls: [empty] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi: true, onProgress });
		await jest.advanceTimersByTimeAsync(90_000);

		await expect(waiting).resolves.toStrictEqual(empty);
		expect(mockReadPullRequestChecks).toHaveBeenCalledTimes(3);
	});

	test('a poll the forge could not answer is retried rather than failing the merge', async () => {
		const { onProgress } = setupPolls({ polls: [undefined, green] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi: false, onProgress });
		await jest.advanceTimersByTimeAsync(60_000);

		await expect(waiting).resolves.toStrictEqual(green);
	});

	test('checks still running at the ceiling come back unfinished, still naming what was being waited on', async () => {
		const { onProgress } = setupPolls({ polls: [running] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi: false, onProgress });
		await jest.advanceTimersByTimeAsync(31 * 60_000);

		await expect(waiting).resolves.toStrictEqual({ ...running, finished: false });
	});

	test('distinguishes unreadable CI from a confirmed empty observation', async () => {
		const { onProgress } = setupPolls({ polls: [empty, undefined] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi: false, onProgress });
		await jest.advanceTimersByTimeAsync(31 * 60_000);

		await expect(waiting).resolves.toStrictEqual({ finished: false, green: true, failing: [], pending: [], passing: [], readable: false });
	});

	test.each([
		{ allowNoCi: true, advanceMs: 90_000, expected: { finished: true, green: true, failing: [], pending: [], passing: [], readable: true } },
		{ allowNoCi: false, advanceMs: 31 * 60_000, expected: { finished: false, green: true, failing: [], pending: [], passing: [], readable: true } },
	])('allows absent checks only after an explicit opt-out and grace', async ({ allowNoCi, advanceMs, expected }) => {
		const { onProgress } = setupPolls({ polls: [empty] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi, onProgress });
		await jest.advanceTimersByTimeAsync(advanceMs);

		await expect(waiting).resolves.toStrictEqual(expected);
	});

	test.each([
		{ polls: [empty, running, red], advanceMs: 90_000, expected: red },
		{ polls: [empty, running], advanceMs: 31 * 60_000, expected: { ...running, finished: false } },
		{ polls: [empty, running, undefined], advanceMs: 31 * 60_000, expected: { ...running, finished: false, readable: false } },
	])('enforces existing checks even when absent CI is allowed', async ({ polls, advanceMs, expected }) => {
		const { onProgress } = setupPolls({ polls });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', expectedHead: 'c0ffee', allowNoCi: true, onProgress });
		await jest.advanceTimersByTimeAsync(advanceMs);

		await expect(waiting).resolves.toStrictEqual(expected);
	});
});

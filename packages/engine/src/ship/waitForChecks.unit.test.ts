import { describe, expect, jest, test } from '@jest/globals';
import { type ChecksSummary, readPullRequestChecks } from '#src/ship/forge/index.ts';
import { waitForChecks } from '#src/ship/waitForChecks.ts';

// The forge is mocked rather than stubbed on PATH: this unit is about waiting,
// and the waits are half an hour long. Fake timers make them instant, and a
// real child process under fake timers would be killed by its own deadline
// rather than answering.
jest.mock('#src/ship/forge/index.ts', () => ({ readPullRequestChecks: jest.fn<typeof readPullRequestChecks>() }));

const mockReadPullRequestChecks = jest.mocked(readPullRequestChecks);

const green: ChecksSummary = { finished: true, green: true, failing: [], pending: [], passing: ['unit'] };
const running: ChecksSummary = { finished: false, green: true, failing: [], pending: ['e2e'], passing: ['unit'] };
const empty: ChecksSummary = { finished: true, green: true, failing: [], pending: [], passing: [] };

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

		const summary = await waitForChecks({ prNumber: 41, cwd: '/repo', onProgress });

		expect(summary).toStrictEqual(green);
		expect(progress).toStrictEqual(['checks: 1 passed, 0 running, 0 failed']);
	});

	test('a check still running is waited on, and the settled answer is what comes back', async () => {
		const { onProgress } = setupPolls({ polls: [running, green] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', onProgress });
		await jest.advanceTimersByTimeAsync(60_000);

		await expect(waiting).resolves.toStrictEqual(green);
	});

	test('an empty check list is polled through a grace window before it counts as no CI at all', async () => {
		const { onProgress } = setupPolls({ polls: [empty] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', onProgress });
		await jest.advanceTimersByTimeAsync(90_000);

		await expect(waiting).resolves.toStrictEqual(empty);
		expect(mockReadPullRequestChecks).toHaveBeenCalledTimes(3);
	});

	test('a poll the forge could not answer is retried rather than failing the merge', async () => {
		const { onProgress } = setupPolls({ polls: [undefined, green] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', onProgress });
		await jest.advanceTimersByTimeAsync(60_000);

		await expect(waiting).resolves.toStrictEqual(green);
	});

	test('checks still running at the ceiling come back unfinished, still naming what was being waited on', async () => {
		const { onProgress } = setupPolls({ polls: [running] });

		const waiting = waitForChecks({ prNumber: 41, cwd: '/repo', onProgress });
		await jest.advanceTimersByTimeAsync(31 * 60_000);

		await expect(waiting).resolves.toStrictEqual({ ...running, finished: false });
	});
});

import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getQueueBoardPath } from '#src/queue/board/index.ts';
import { getRunDir } from '#src/runState/index.ts';

/** A main checkout with two coordinator runs, and the board file each run's own folder should hold. */
const setupRuns = () => {
	const cwd = '/repo';
	const runIds = ['run-queue-1', 'run-queue-2'];
	const expectedPaths = runIds.map((runId) => join(getRunDir({ cwd, runId }), 'board.json'));

	return { cwd, runIds, expectedPaths };
};

describe('getQueueBoardPath', () => {
	test("files the board in the coordinator run's own folder", () => {
		const { cwd, runIds, expectedPaths } = setupRuns();

		const boardPaths = runIds.map((runId) => getQueueBoardPath({ cwd, runId }));

		expect(boardPaths).toEqual(expectedPaths);
		expect(new Set(boardPaths).size).toBe(2);
	});
});

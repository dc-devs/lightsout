import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getQueueBoardPath } from '#src/queue/board/index.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

/** A main checkout with two coordinator runs on disk, and the board file each run's own folder should hold. */
const setupRuns = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-board-path-'));
	const runIds = ['run-queue-1', 'run-queue-2'];
	const expectedPaths = runIds.map((runId) => {
		const runDir = runDirFor({ cwd, runId, pipeline: 'queue' });

		mkdirSync(runDir, { recursive: true });

		return join(runDir, 'board.json');
	});

	return { cwd, runIds, expectedPaths };
};

describe('getQueueBoardPath', () => {
	test("files the board in the coordinator run's own folder", async () => {
		const { cwd, runIds, expectedPaths } = setupRuns();

		const boardPaths = await Promise.all(runIds.map((runId) => getQueueBoardPath({ cwd, runId })));

		expect(boardPaths).toEqual(expectedPaths);
		expect(new Set(boardPaths).size).toBe(2);
	});
});

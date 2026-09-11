import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type QueueBoard, QueueLane } from '#src/contracts/index.ts';
import { getQueueBoardPath, readQueueBoard } from '#src/queue/board/index.ts';

/** A board carrying every optional field beside a ticket with none, so a lossy read shows. */
const recordedBoard: QueueBoard = {
	coordinatorRunId: 'run-queue-1',
	updatedAt: '2026-09-10T09:30:00.000Z',
	tickets: [
		{
			identifier: 'LO-1',
			title: 'Show the board',
			url: 'https://linear.app/lightsout/issue/LO-1',
			lane: QueueLane.Blocked,
			worker: 'auto-plan',
			planName: 'lo-1-show-the-board',
			branch: 'lo-1-show-the-board',
			worktreePath: '/worktrees/lo-1-show-the-board',
			enteredAt: '2026-09-10T09:20:00.000Z',
			buildStartedAt: '2026-09-10T09:10:00.000Z',
			reason: 'Which column comes first?',
			question: 'Which column comes first?',
		},
		{ identifier: 'LO-2', lane: QueueLane.BuildQueue, enteredAt: '2026-09-10T09:00:00.000Z' },
	],
};

/** An empty main checkout, and a hand-written board file per run for the cases the recorder would never write. */
const setupCheckout = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-queue-board-'));

	for (const [runId, contents] of Object.entries(files)) {
		const path = getQueueBoardPath({ cwd, runId });
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents);
	}

	return { cwd };
};

describe('readQueueBoard', () => {
	test('reads back the board recorded for the run', async () => {
		const { cwd } = setupCheckout({ files: { 'run-queue-1': JSON.stringify(recordedBoard) } });

		const board = await readQueueBoard({ cwd, runId: 'run-queue-1' });

		expect(board).toStrictEqual(recordedBoard);
	});

	test('answers undefined when the run has no board', async () => {
		const { cwd } = setupCheckout();

		const board = await readQueueBoard({ cwd, runId: 'run-queue-1' });

		expect(board).toBe(undefined);
	});

	test('answers undefined for a board it cannot parse or that breaks the contract', async () => {
		const { cwd } = setupCheckout({
			files: {
				'run-garbled': '{ this is not json',
				'run-off-contract': JSON.stringify({
					...recordedBoard,
					tickets: [{ identifier: 'LO-3', lane: 'waiting', enteredAt: '2026-09-10T09:00:00.000Z' }],
				}),
			},
		});

		const boards = await Promise.all([readQueueBoard({ cwd, runId: 'run-garbled' }), readQueueBoard({ cwd, runId: 'run-off-contract' })]);

		expect(boards).toEqual([undefined, undefined]);
	});
});

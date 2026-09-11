import { describe, expect, test } from '@jest/globals';
import { QueueBoard } from '#src/contracts/index.ts';

const setupBoards = () => {
	const board = {
		coordinatorRunId: 'run-queue-1',
		updatedAt: '2026-09-10T09:30:00.000Z',
		tickets: [{ identifier: 'LO-136', lane: 'building', enteredAt: '2026-09-10T09:20:00.000Z' }],
	};
	const boardWithoutRunId = { updatedAt: board.updatedAt, tickets: board.tickets };

	return { board, boardWithoutRunId };
};

describe('QueueBoard', () => {
	test('refuses a board that does not name its coordinator run', () => {
		const { board, boardWithoutRunId } = setupBoards();

		const accepted = QueueBoard.safeParse(board);
		const refused = QueueBoard.safeParse(boardWithoutRunId);

		expect(accepted.data).toStrictEqual(board);
		expect(refused.success).toBe(false);
	});
});

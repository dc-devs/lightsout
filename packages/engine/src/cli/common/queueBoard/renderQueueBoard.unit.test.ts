import { describe, expect, test } from '@jest/globals';
import { QueueBoardState } from '#src/cli/common/constants/QueueBoardState.ts';
import { renderQueueBoard } from '#src/cli/common/queueBoard/renderQueueBoard.ts';
import { type QueueBoardTicket, QueueLane } from '#src/contracts/index.ts';

type BoardParams = Parameters<typeof renderQueueBoard>[0];

const headerRow = '| Build Queue | Building | Ship Queue | Shipping Now | Shipped | Parked | Blocked |';
const separatorRow = '| --- | --- | --- | --- | --- | --- | --- |';

/** One board ticket with no url, in the given lane. */
const boardTicket = ({ identifier, title, lane, reason }: { identifier: string; title?: string; lane: QueueLane; reason?: string }): QueueBoardTicket => ({
	identifier,
	title,
	lane,
	reason,
	enteredAt: '2026-09-11T08:00:00.000Z',
});

/** A body row's cells, left to right, without their padding. The fixtures hold no pipe, so a plain split is exact. */
const toCells = (row: string) =>
	row
		.split('|')
		.slice(1, -1)
		.map((cell) => cell.trim());

/** Two Building, one Ship Queue and three Blocked tickets, interleaved, with identifiers that would sort differently from input order. */
const stackedTickets = [
	boardTicket({ identifier: 'EX-9', title: 'Nine', lane: QueueLane.Blocked, reason: 'first hold' }),
	boardTicket({ identifier: 'EX-7', title: 'Seven', lane: QueueLane.Building }),
	boardTicket({ identifier: 'EX-3', title: 'Three', lane: QueueLane.Blocked, reason: 'second hold' }),
	boardTicket({ identifier: 'EX-6', title: 'Six', lane: QueueLane.ShipQueue }),
	boardTicket({ identifier: 'EX-2', title: 'Two', lane: QueueLane.Building }),
	boardTicket({ identifier: 'EX-5', title: 'Five', lane: QueueLane.Blocked, reason: 'third hold' }),
];

/** The board's inputs, rendered at the given local wall-clock time on 2026-09-11. */
const setupBoard = ({
	tickets = [],
	state = QueueBoardState.Live,
	hours = 10,
	minutes = 20,
}: {
	tickets?: QueueBoardTicket[];
	state?: QueueBoardState;
	hours?: number;
	minutes?: number;
} = {}): BoardParams => ({ tickets, state, at: new Date(2026, 8, 11, hours, minutes) });

describe('renderQueueBoard', () => {
	test('heads a live board with the render time and the next update ten minutes later', () => {
		const params = setupBoard({ hours: 9, minutes: 5 });

		const lines = renderQueueBoard(params);

		expect(lines.slice(0, 2)).toStrictEqual(['Queue update · 09:05 · next update 09:15', '']);
	});

	test('wraps the next update past midnight', () => {
		const params = setupBoard({ hours: 23, minutes: 55 });

		const lines = renderQueueBoard(params);

		expect(lines[0]).toBe('Queue update · 23:55 · next update 00:05');
	});

	test('heads a stopped board with its last update and a finished board with its finish time', () => {
		const { at, tickets } = setupBoard({ hours: 14, minutes: 2 });

		const headings = [QueueBoardState.Stopped, QueueBoardState.Finished].map((state) => renderQueueBoard({ tickets, state, at })[0]);

		expect(headings).toStrictEqual(['Queue stopped · last update 14:02', 'Queue finished · 14:02']);
	});

	test("lays out seven columns in lane order with row N holding each lane's Nth ticket", () => {
		const params = setupBoard({ tickets: stackedTickets });

		const lines = renderQueueBoard(params);

		expect(lines.slice(2).map(toCells)).toStrictEqual([
			['Build Queue', 'Building', 'Ship Queue', 'Shipping Now', 'Shipped', 'Parked', 'Blocked'],
			['---', '---', '---', '---', '---', '---', '---'],
			['—', 'EX-7 · Seven', 'EX-6 · Six', '—', '—', '—', 'EX-9 · Nine — first hold'],
			['', 'EX-2 · Two', '', '', '', '', 'EX-3 · Three — second hold'],
			['', '', '', '', '', '', 'EX-5 · Five — third hold'],
		]);
	});

	test('keeps an empty lane as a column with an em dash in its first row', () => {
		const params = setupBoard({ tickets: stackedTickets });

		const lines = renderQueueBoard(params);

		const bodyCells = lines.slice(4).map(toCells);
		const emptyLaneColumns = [0, 3, 4, 5].map((column) => bodyCells.map((cells) => cells[column]));

		expect(emptyLaneColumns).toStrictEqual([
			['—', '', ''],
			['—', '', ''],
			['—', '', ''],
			['—', '', ''],
		]);
	});

	test("reproduces the ticket's example board, with two tickets stacked in three columns", () => {
		const params = setupBoard({
			tickets: [
				boardTicket({ identifier: 'EX-101', title: 'Notifications', lane: QueueLane.BuildQueue }),
				boardTicket({ identifier: 'EX-109', title: 'Permissions', lane: QueueLane.BuildQueue }),
				boardTicket({ identifier: 'EX-102', title: 'API changes', lane: QueueLane.Building }),
				boardTicket({ identifier: 'EX-103', title: 'Search changes', lane: QueueLane.Building }),
				boardTicket({ identifier: 'EX-104', title: 'Exports', lane: QueueLane.ShipQueue }),
				boardTicket({ identifier: 'EX-105', title: 'Audit log', lane: QueueLane.ShipQueue }),
				boardTicket({ identifier: 'EX-106', title: 'Settings', lane: QueueLane.Shipped }),
				boardTicket({ identifier: 'EX-107', title: 'Import fix', lane: QueueLane.Parked, reason: 'retry needed' }),
				boardTicket({ identifier: 'EX-108', title: 'Migration', lane: QueueLane.Blocked, reason: 'dependency' }),
			],
		});

		const lines = renderQueueBoard(params);

		expect(lines).toStrictEqual([
			'Queue update · 10:20 · next update 10:30',
			'',
			headerRow,
			separatorRow,
			'| EX-101 · Notifications | EX-102 · API changes | EX-104 · Exports | — | EX-106 · Settings | EX-107 · Import fix — retry needed | EX-108 · Migration — dependency |',
			'| EX-109 · Permissions | EX-103 · Search changes | EX-105 · Audit log |  |  |  |  |',
		]);
	});

	test('draws one row of em dashes when the board holds no ticket', () => {
		const params = setupBoard();

		const lines = renderQueueBoard(params);

		expect(lines).toStrictEqual(['Queue update · 10:20 · next update 10:30', '', headerRow, separatorRow, '| — | — | — | — | — | — | — |']);
	});

	test('appends a reason only to Parked, Blocked and Shipped cells', () => {
		const params = setupBoard({
			tickets: [
				boardTicket({ identifier: 'EX-11', title: 'Import fix', lane: QueueLane.Parked, reason: 'retry' }),
				boardTicket({ identifier: 'EX-12', title: 'Migration', lane: QueueLane.Blocked, reason: 'held by EX-1' }),
				boardTicket({ identifier: 'EX-13', title: 'Settings', lane: QueueLane.Shipped, reason: 'tracker failed' }),
				boardTicket({ identifier: 'EX-14', title: 'Search', lane: QueueLane.Building, reason: 'hidden' }),
			],
		});

		const lines = renderQueueBoard(params);

		expect(lines.slice(4).map(toCells)).toStrictEqual([
			['—', 'EX-14 · Search', '—', '—', 'EX-13 · Settings — tracker failed', 'EX-11 · Import fix — retry', 'EX-12 · Migration — held by EX-1'],
		]);
	});

	test('clips a long multi-line reason to one line of 120 characters', () => {
		const reason = ['x'.repeat(99), 'y'.repeat(99), 'z'.repeat(100)].join('\n');
		const params = setupBoard({
			tickets: [boardTicket({ identifier: 'EX-21', title: 'Import fix', lane: QueueLane.Parked, reason })],
		});

		const lines = renderQueueBoard(params);

		const clippedReason = `${'x'.repeat(99)} ${'y'.repeat(19)}…`;

		expect(lines.slice(4).map(toCells)).toStrictEqual([['—', '—', '—', '—', '—', `EX-21 · Import fix — ${clippedReason}`, '—']]);
	});
});

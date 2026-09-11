import { describe, expect, test } from '@jest/globals';
import { renderTicketDetailBlock } from '#src/cli/common/queueBoard/renderTicketDetailBlock.ts';
import { type QueueBoardTicket, QueueLane } from '#src/contracts/index.ts';

/** Status lines as the status command prints them: a title, an indented row, an empty line and a trailing space the block must keep. */
const statusLines = [
	'demo                                     implement',
	'─────────────────────────────────────────────────',
	' ✓  plan                 passed            0m 30s',
	'',
	'    ·  implement         —   ',
	' now  implement running since 10:12',
];

const setupTicket = ({ question }: { question?: string } = {}) => {
	const ticket: QueueBoardTicket = {
		identifier: 'EX-102',
		title: 'API changes',
		url: 'https://tracker.example.com/EX-102',
		lane: question === undefined ? QueueLane.Building : QueueLane.Blocked,
		worktreePath: '/tmp/worktrees/ex-102-api-changes',
		enteredAt: '2026-09-11T10:10:00.000Z',
		buildStartedAt: '2026-09-11T10:00:00.000Z',
		...(question === undefined ? {} : { reason: question, question }),
	};

	return { ticket, lines: [...statusLines] };
};

describe('renderTicketDetailBlock', () => {
	test('wraps the given lines unchanged in a text fence under a bold linked heading', () => {
		const { ticket, lines } = setupTicket();

		const block = renderTicketDetailBlock({ ticket, lines });

		expect(block).toStrictEqual([
			'',
			'**[EX-102 · API changes](https://tracker.example.com/EX-102)**',
			'',
			'```text',
			'demo                                     implement',
			'─────────────────────────────────────────────────',
			' ✓  plan                 passed            0m 30s',
			'',
			'    ·  implement         —   ',
			' now  implement running since 10:12',
			'```',
		]);
	});

	test('states a waiting question in the heading, on one line and outside the fence', () => {
		const { ticket, lines } = setupTicket({ question: 'Should the export\n  include archived rows?' });

		const block = renderTicketDetailBlock({ ticket, lines });

		expect(block).toEqual([
			'',
			expect.stringMatching(
				/^\*\*\[EX-102 · API changes\]\(https:\/\/tracker\.example\.com\/EX-102\)\*\*.*waiting for an answer.*Should the export include archived rows\?$/,
			),
			'',
			'```text',
			...statusLines,
			'```',
		]);
	});
});

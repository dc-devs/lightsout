import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { BoardQuestionRelay, QueueBoardRecorder, readQueueBoard } from '#src/queue/board/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

type AskParams = { question: string; ticket: TicketSummary; coordinatorRunId: string; coordinatorRunDir: string };

/**
 * A wrapper around a stand-in CLI relay whose question stays open until the
 * test answers or refuses it, over a real recorder whose last snapshot holds
 * the asking ticket's build in flight. The board file is real, because what
 * the wrapper puts on it is the behaviour under test.
 */
const setupRelay = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-board-relay-'));
	const runId = 'run-q';
	const ticket = queueTicketFixture();
	const board = new QueueBoardRecorder({ cwd, runId, branchTemplate: queueSettingsFixture().branchTemplate });
	const sink = jest.fn<(message: string) => void>();
	let answerWith: (answer: string) => void = () => undefined;
	let refuseWith: (error: Error) => void = () => undefined;
	let signalAsked: () => void = () => undefined;
	const asked = new Promise<void>((resolve) => {
		signalAsked = resolve;
	});
	const inner = {
		ask: jest.fn<(params: AskParams) => Promise<string>>(
			() =>
				new Promise<string>((resolve, reject) => {
					answerWith = resolve;
					refuseWith = reject;
					signalAsked();
				}),
		),
		createProgressSink: jest.fn<(params: { ticket: TicketSummary }) => (message: string) => void>(() => sink),
		close: jest.fn<() => void>(),
	};

	board.record({
		settled: { outcomes: [], leftBehind: [] },
		lanes: { pending: [], building: [{ ticket, startedAt: '2026-01-01T00:05:00.000Z' }], readyToShip: [], shipping: undefined, blocked: [] },
	});

	const relay = new BoardQuestionRelay({ relay: inner, board });
	const params: AskParams = { question: 'Which one?', ticket, coordinatorRunId: runId, coordinatorRunDir: join(cwd, '.lightsout', 'runs', runId) };

	/** The asking ticket as the board file shows it once every queued write has landed. */
	const readBoardTicket = async () => {
		await board.flush();

		const recorded = await readQueueBoard({ cwd, runId });

		return recorded?.tickets.find((entry) => entry.identifier === 'LO-70');
	};

	return {
		relay,
		inner,
		sink,
		params,
		asked,
		answer: (answer: string) => answerWith(answer),
		refuse: (error: Error) => refuseWith(error),
		readBoardTicket,
	};
};

describe('BoardQuestionRelay', () => {
	test('marks the ticket waiting while the question is open and returns the answer unchanged', async () => {
		const { relay, params, asked, answer, readBoardTicket } = setupRelay();

		const answering = relay.ask(params);
		await asked;
		const whileOpen = await readBoardTicket();
		answer('  the second one  ');
		const given = await answering;
		const afterAnswer = await readBoardTicket();

		expect(whileOpen).toEqual(expect.objectContaining({ lane: 'blocked', reason: 'Which one?', question: 'Which one?' }));
		expect(given).toBe('  the second one  ');
		expect(afterAnswer).toEqual(expect.objectContaining({ lane: 'building', buildStartedAt: '2026-01-01T00:05:00.000Z' }));
		expect(afterAnswer?.question).toBeUndefined();
	});

	test("rethrows an unanswerable question's error and clears the wait", async () => {
		const { relay, params, asked, refuse, readBoardTicket } = setupRelay();
		const refusal = new Error('No answer arrived within the question timeout');

		const answering = relay.ask(params);
		await asked;
		refuse(refusal);
		const error = await getRejectionError({ promise: answering });
		const afterRefusal = await readBoardTicket();

		expect(error).toBe(refusal);
		expect(afterRefusal).toEqual(expect.objectContaining({ lane: 'building', buildStartedAt: '2026-01-01T00:05:00.000Z' }));
		expect(afterRefusal?.question).toBeUndefined();
	});

	test('forwards every relay call to the relay it wraps', async () => {
		const { relay, inner, sink, params, asked, answer } = setupRelay();

		const answering = relay.ask(params);
		await asked;
		answer('the second one');
		await answering;
		const progressSink = relay.createProgressSink({ ticket: params.ticket });
		relay.close();

		expect(inner.ask.mock.calls).toStrictEqual([[params]]);
		expect(inner.createProgressSink.mock.calls).toStrictEqual([[{ ticket: params.ticket }]]);
		expect(progressSink).toBe(sink);
		expect(inner.close).toHaveBeenCalledTimes(1);
	});
});

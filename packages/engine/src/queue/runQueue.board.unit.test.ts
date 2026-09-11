import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { QueueBoard } from '#src/contracts/index.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { readQueueBoard } from '#src/queue/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueOutcomeFixture as outcomeOf } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueTicketFixture as ticketOf } from '#tests/helpers/queueTicketFixture.ts';
import { setupQueueDrain } from '#tests/helpers/setupQueueDrain.ts';

// Mocked Imports
// -------------------------
// The tracker, the per-ticket run and the serial merge are each covered by their
// own tests. What this file owns is the board the coordinator run leaves behind,
// and that the relay a worker is handed puts its open question on that board
// without changing how the question travels.
/** The fields of `runQueueTicket`'s params a worker here reads: its ticket, the relay it asks through, and the coordinator run it stamps on the question. */
interface WorkerParams {
	ticket: TicketSummary;
	relay: QuestionRelay;
	coordinatorRunId: string;
	coordinatorRunDir: string;
}

const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: WorkerParams) => Promise<TicketRunOutcome>>();
const mockShipOneBranch = jest.fn<(params: { outcome: TicketRunOutcome }) => Promise<TicketRunOutcome>>();
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean };

const mockSetTicketLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/ticketSelection/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	setTicketLabel: (params: LabelParams) => mockSetTicketLabel(params),
}));
jest.mock('#src/queue/worktrees/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueTicket.ts', () => ({ runQueueTicket: (params: WorkerParams) => mockRunQueueTicket(params) }));
jest.mock('#src/queue/shipOneBranch.ts', () => ({ shipOneBranch: (params: { outcome: TicketRunOutcome }) => mockShipOneBranch(params) }));
// -------------------------

const QUESTION = 'Which column comes first on the board?';
const ANSWER = 'Build Queue, then the rest in the brainstorm order.';

/** A repo with a remote behind it and every collaborator stubbed green; `parkedTicket` is the one ticket whose build stops. */
const setupDrain = ({
	eligible = [],
	parked,
	parkedTicket,
}: {
	eligible?: TicketSummary[];
	parked?: ParkedWork;
	parkedTicket?: { identifier: string; error: string };
} = {}) => {
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue(parked ?? { resumed: [], outcomes: [], leftBehind: [], merged: [] });
	mockRunQueueTicket.mockImplementation(({ ticket }) =>
		Promise.resolve(ticket.identifier === parkedTicket?.identifier ? outcomeOf({ ticket, ready: false, error: parkedTicket.error }) : outcomeOf({ ticket })),
	);
	mockShipOneBranch.mockImplementation(({ outcome }) => Promise.resolve(outcome));
	mockSetTicketLabel.mockResolvedValue(undefined);

	return setupQueueDrain();
};

/** The id of the one coordinator run the drain created. */
const readCoordinatorRunId = ({ cwd }: { cwd: string }) => readdirSync(join(cwd, '.lightsout', 'runs'))[0];

/**
 * The board once it shows what `shows` looks for, or the last one read when it
 * never does — so a board that never shows it fails the assertion rather than
 * holding the drain open forever.
 */
const waitForBoard = async ({
	cwd,
	runId,
	shows,
	attempts = 200,
}: {
	cwd: string;
	runId: string;
	shows: (board: QueueBoard | undefined) => boolean;
	attempts?: number;
}): Promise<QueueBoard | undefined> => {
	const board = await readQueueBoard({ cwd, runId });

	if (shows(board) || attempts === 0) {
		return board;
	}

	await new Promise((settle) => setTimeout(settle, 10));

	return waitForBoard({ cwd, runId, shows, attempts: attempts - 1 });
};

/**
 * One ticket whose worker asks a question through the relay `runQueue` handed it.
 *
 * The CLI relay's `ask` is spied on the relay the drain was given: while the
 * question is open it waits for the board to show the wait and keeps that
 * board, then answers. The worker keeps the question it sent and the answer it
 * got, so what the CLI relay received and what the worker got back can each be
 * compared with the other end.
 */
const setupQuestion = () => {
	const base = setupDrain({ eligible: [ticketOf({ number: 70 })] });
	const sent: Parameters<QuestionRelay['ask']>[0][] = [];
	const answers: string[] = [];
	const boardsWhileOpen: (QueueBoard | undefined)[] = [];
	const cliAsk = jest.spyOn(base.relay, 'ask').mockImplementation(async ({ coordinatorRunId }) => {
		const board = await waitForBoard({
			cwd: base.cwd,
			runId: coordinatorRunId,
			shows: (read) => read?.tickets.some((ticket) => ticket.identifier === 'LO-70' && ticket.lane === 'blocked') === true,
		});

		boardsWhileOpen.push(board);

		return ANSWER;
	});

	mockRunQueueTicket.mockImplementation(async ({ ticket, relay, coordinatorRunId, coordinatorRunDir }) => {
		const question = { question: QUESTION, ticket, coordinatorRunId, coordinatorRunDir };

		sent.push(question);
		answers.push(await relay.ask(question));

		return outcomeOf({ ticket });
	});

	return { ...base, cliAsk, sent, answers, boardsWhileOpen };
};

describe('runQueue', () => {
	test("leaves the coordinator run's board showing every ticket's final lane when it returns", async () => {
		const { cwd, drain, relay } = setupDrain({
			eligible: [ticketOf({ number: 70 }), ticketOf({ number: 71 })],
			parkedTicket: { identifier: 'LO-71', error: 'tsc: 3 errors' },
		});

		await drain();

		relay.close();

		const runId = readCoordinatorRunId({ cwd });
		const board = await readQueueBoard({ cwd, runId });

		expect(board).toEqual({
			coordinatorRunId: runId,
			updatedAt: expect.any(String),
			tickets: [
				expect.objectContaining({ identifier: 'LO-70', lane: 'shipped' }),
				expect.objectContaining({ identifier: 'LO-71', lane: 'parked', reason: 'tsc: 3 errors' }),
			],
		});
	});

	test("marks a worker's open question on the board without changing how it is delivered or answered", async () => {
		const { cwd, drain, relay, cliAsk, sent, answers, boardsWhileOpen } = setupQuestion();

		await drain();

		relay.close();

		const runId = readCoordinatorRunId({ cwd });
		const [{ ticket }] = sent;

		expect(cliAsk.mock.calls).toStrictEqual([[{ question: QUESTION, ticket, coordinatorRunId: runId, coordinatorRunDir: getRunDir({ cwd, runId }) }]]);
		expect(boardsWhileOpen).toEqual([
			expect.objectContaining({
				coordinatorRunId: runId,
				tickets: [expect.objectContaining({ identifier: 'LO-70', lane: 'blocked', reason: QUESTION, question: QUESTION })],
			}),
		]);
		expect(answers).toStrictEqual([ANSWER]);
	});

	test("puts the parked scan's left-behind tickets on the board and keeps the report's order", async () => {
		const withdrawn = {
			identifier: 'LO-99',
			title: 'Ticket 99',
			url: 'https://linear.app/lightsout/issue/LO-99',
			reason: 'its worktree is parked, but the ticket carries no planning status label any more',
		};
		const { cwd, drain, relay } = setupDrain({
			eligible: [ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] })],
			parked: { resumed: [], outcomes: [], leftBehind: [withdrawn], merged: [] },
		});

		const report = await drain();

		relay.close();

		const runId = readCoordinatorRunId({ cwd });
		const board = await readQueueBoard({ cwd, runId });
		const blocked = board?.tickets.filter((ticket) => ticket.lane === 'blocked');

		expect(blocked).toEqual([
			expect.objectContaining({ identifier: 'LO-99', title: 'Ticket 99', url: 'https://linear.app/lightsout/issue/LO-99', reason: withdrawn.reason }),
			expect.objectContaining({ identifier: 'LO-71', reason: expect.stringContaining('blocked by LO-69') }),
		]);
		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) })],
			leftBehind: [withdrawn, expect.objectContaining({ identifier: 'LO-71', reason: expect.stringContaining('blocked by LO-69') })],
		});
	});
});

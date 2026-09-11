import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { QueueBoard } from '#src/contracts/index.ts';
import { getQueueBoardPath, QueueBoardRecorder, toQueueBoardTickets } from '#src/queue/board/index.ts';
import type { QueueDrainReport, TicketRunOutcome } from '#src/queue/index.ts';
import { resolveWorktreesRoot } from '#src/worktree/index.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

type RunnableTicket = ReturnType<typeof queueTicketFixture>;

interface Lanes {
	pending: RunnableTicket[];
	building: { ticket: RunnableTicket; startedAt: string }[];
	readyToShip: TicketRunOutcome[];
	shipping: TicketRunOutcome | undefined;
	blocked: QueueDrainReport['leftBehind'];
}

/** When every snapshot in a test is taken, unless the test moves the clock on. */
const snapshotTime = '2026-09-10T10:00:00.000Z';

/**
 * A recorder over a fresh main checkout, with only the clock faked, so every
 * snapshot's time is known and the file writes and the git lookup for the
 * worktrees root stay real. `runsFolderIsAFile` puts a plain file where the
 * runs folder belongs, so every board write is refused until the test calls
 * `unblockRunsFolder`. `reportsProgress: false` builds the recorder with no
 * progress sink at all.
 */
const setupRecorder = ({ runsFolderIsAFile = false, reportsProgress = true }: { runsFolderIsAFile?: boolean; reportsProgress?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-board-recorder-'));
	const runId = 'run-queue-1';
	const branchTemplate = queueSettingsFixture().branchTemplate;
	const progress: string[] = [];
	const boardPath = getQueueBoardPath({ cwd, runId });
	const runsFolder = join(cwd, '.lightsout', 'runs');

	if (runsFolderIsAFile) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(runsFolder, 'not a directory\n');
	}

	jest.useFakeTimers({
		now: new Date(snapshotTime),
		doNotFake: [
			'hrtime',
			'nextTick',
			'performance',
			'queueMicrotask',
			'requestAnimationFrame',
			'cancelAnimationFrame',
			'requestIdleCallback',
			'cancelIdleCallback',
			'setImmediate',
			'clearImmediate',
			'setInterval',
			'clearInterval',
			'setTimeout',
			'clearTimeout',
			'Temporal',
		],
	});

	const onProgress = reportsProgress ? (message: string) => progress.push(message) : undefined;
	const recorder = new QueueBoardRecorder({ cwd, runId, branchTemplate, onProgress });

	/** The board file as the contract reads it; throws when the file is missing or off-contract. */
	const readBoardFile = async () => QueueBoard.parse(JSON.parse(await readFile(boardPath, 'utf8')));

	/** Take away the plain file in the runs folder's place, so the next board write can land. */
	const unblockRunsFolder = () => rmSync(runsFolder);

	return { cwd, runId, branchTemplate, progress, boardPath, recorder, readBoardFile, unblockRunsFolder };
};

/** Lanes holding nothing but what a test names. */
const lanesOf = (overrides: Partial<Lanes> = {}): Lanes => ({
	pending: [],
	building: [],
	readyToShip: [],
	shipping: undefined,
	blocked: [],
	...overrides,
});

const noSettled = (): QueueDrainReport => ({ outcomes: [], leftBehind: [] });

/** The identifier and lane of each ticket on a board, in board order. */
const placesOf = (board: QueueBoard) => board.tickets.map(({ identifier, lane }) => ({ identifier, lane }));

describe('QueueBoardRecorder', () => {
	test("writes the snapshot to the run's board file through a temporary file", async () => {
		const { cwd, runId, branchTemplate, boardPath, recorder, readBoardFile } = setupRecorder();
		const settled: QueueDrainReport = {
			outcomes: [queueOutcomeFixture({ ticket: queueTicketFixture({ number: 73 }) })],
			leftBehind: [{ identifier: 'LO-74', reason: 'blocked by LO-1, which is not finished' }],
		};
		const lanes = lanesOf({
			pending: [queueTicketFixture({ number: 71 })],
			building: [{ ticket: queueTicketFixture({ number: 75, worker: 'auto-plan' }), startedAt: '2026-09-10T09:50:00.000Z' }],
			readyToShip: [queueOutcomeFixture({ ticket: queueTicketFixture({ number: 72 }) })],
		});
		const worktreesRoot = await resolveWorktreesRoot({ cwd });
		const expectedTickets = toQueueBoardTickets({
			settled,
			live: { ...lanes, questions: new Map(), entered: new Map(), branchTemplate, worktreesRoot },
			at: snapshotTime,
		});

		recorder.record({ settled, lanes });
		await recorder.flush();
		const board = await readBoardFile();

		expect(board).toEqual({ coordinatorRunId: runId, updatedAt: snapshotTime, tickets: expectedTickets });
		expect(readdirSync(dirname(boardPath))).toStrictEqual(['board.json']);
	});

	test('writes snapshots one at a time in the order they were recorded', async () => {
		const { recorder, readBoardFile } = setupRecorder();

		recorder.record({ settled: noSettled(), lanes: lanesOf({ pending: [queueTicketFixture({ number: 71 })] }) });
		recorder.record({ settled: noSettled(), lanes: lanesOf({ pending: [queueTicketFixture({ number: 72 })] }) });
		await recorder.flush();
		const board = await readBoardFile();

		expect(placesOf(board)).toStrictEqual([{ identifier: 'LO-72', lane: 'build-queue' }]);
	});

	test('writes the lanes as they stood when the snapshot was taken', async () => {
		const { recorder, readBoardFile } = setupRecorder();
		const settled = noSettled();
		const lanes = lanesOf({
			pending: [queueTicketFixture({ number: 71 })],
			blocked: [{ identifier: 'LO-74', reason: 'blocked by LO-1, which is not finished' }],
		});

		recorder.record({ settled, lanes });
		lanes.pending.push(queueTicketFixture({ number: 72 }));
		lanes.blocked.splice(0);
		settled.outcomes.push(queueOutcomeFixture({ ticket: queueTicketFixture({ number: 73 }) }));
		await recorder.flush();
		const board = await readBoardFile();

		expect(placesOf(board)).toStrictEqual([
			{ identifier: 'LO-71', lane: 'build-queue' },
			{ identifier: 'LO-74', lane: 'blocked' },
		]);
	});

	test("keeps a ticket's entry time across writes while it stays in its lane", async () => {
		const { recorder, readBoardFile } = setupRecorder();
		const staying = queueTicketFixture({ number: 71 });
		const moving = queueTicketFixture({ number: 72 });

		recorder.record({ settled: noSettled(), lanes: lanesOf({ pending: [staying, moving] }) });
		await recorder.flush();
		jest.setSystemTime(new Date('2026-09-10T10:05:00.000Z'));
		recorder.record({ settled: noSettled(), lanes: lanesOf({ pending: [staying], readyToShip: [queueOutcomeFixture({ ticket: moving })] }) });
		await recorder.flush();
		const board = await readBoardFile();

		expect(board.updatedAt).toBe('2026-09-10T10:05:00.000Z');
		expect(board.tickets.map(({ identifier, lane, enteredAt }) => ({ identifier, lane, enteredAt }))).toStrictEqual([
			{ identifier: 'LO-71', lane: 'build-queue', enteredAt: '2026-09-10T10:00:00.000Z' },
			{ identifier: 'LO-72', lane: 'ship-queue', enteredAt: '2026-09-10T10:05:00.000Z' },
		]);
	});

	test('rewrites the board when a worker starts and stops waiting for an answer', async () => {
		const { recorder, readBoardFile } = setupRecorder();
		const ticket = queueTicketFixture({ number: 71 });
		const question = 'Which column comes first?';
		recorder.record({ settled: noSettled(), lanes: lanesOf({ building: [{ ticket, startedAt: '2026-09-10T09:50:00.000Z' }] }) });
		await recorder.flush();

		recorder.markWaiting({ ticket, question });
		await recorder.flush();
		const whileWaiting = await readBoardFile();
		recorder.clearWaiting({ ticket });
		await recorder.flush();
		const afterAnswer = await readBoardFile();

		expect(whileWaiting.tickets).toEqual([
			expect.objectContaining({ identifier: 'LO-71', lane: 'blocked', reason: question, question, buildStartedAt: '2026-09-10T09:50:00.000Z' }),
		]);
		expect(afterAnswer.tickets).toEqual([expect.objectContaining({ identifier: 'LO-71', lane: 'building', buildStartedAt: '2026-09-10T09:50:00.000Z' })]);
		expect(afterAnswer.tickets[0]).not.toHaveProperty('question');
	});

	test('writes nothing for a wait until the drain has recorded a snapshot', async () => {
		const { boardPath, recorder } = setupRecorder();

		recorder.markWaiting({ ticket: queueTicketFixture({ number: 71 }), question: 'Which column comes first?' });
		await recorder.flush();

		expect(existsSync(boardPath)).toBe(false);
	});

	test('reports a failed board write as one progress line and keeps recording', async () => {
		const { boardPath, progress, recorder } = setupRecorder({ runsFolderIsAFile: true });
		const snapshot = { settled: noSettled(), lanes: lanesOf({ pending: [queueTicketFixture({ number: 71 })] }) };

		const recording = (async () => {
			recorder.record(snapshot);
			await recorder.flush();
			recorder.record(snapshot);
			await recorder.flush();
		})();

		await expect(recording).resolves.toBeUndefined();
		expect(progress).toEqual([expect.stringContaining(boardPath), expect.stringContaining(boardPath)]);
		expect(progress).toEqual([expect.stringMatching(/ENOTDIR|EEXIST|not a directory/), expect.stringMatching(/ENOTDIR|EEXIST|not a directory/)]);
	});

	test('writes the next snapshot after a failed write when it has no progress sink', async () => {
		const { recorder, readBoardFile, unblockRunsFolder } = setupRecorder({ runsFolderIsAFile: true, reportsProgress: false });

		recorder.record({ settled: noSettled(), lanes: lanesOf({ pending: [queueTicketFixture({ number: 71 })] }) });
		await recorder.flush();
		unblockRunsFolder();
		recorder.record({ settled: noSettled(), lanes: lanesOf({ pending: [queueTicketFixture({ number: 72 })] }) });
		await recorder.flush();
		const board = await readBoardFile();

		expect(placesOf(board)).toStrictEqual([{ identifier: 'LO-72', lane: 'build-queue' }]);
	});
});

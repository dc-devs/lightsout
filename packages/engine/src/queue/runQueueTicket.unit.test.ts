import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/index.ts';
import { runQueueTicket } from '#src/queue/runQueueTicket.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Each step this sequence calls is covered by its own tests; what this file owns
// is the order they run in, and which of them decides the ticket is not ready.
const mockCreateTicketWorktree = jest.fn<(params: { branch: string }) => Promise<string | QueueFailure>>();
const mockSetTicketStatus = jest.fn<(params: { statusName: string }) => Promise<QueueFailure | undefined>>();
const mockRunWorkerWithRelay = jest.fn<() => Promise<WorkerOutcome>>();
const mockCommitTicketWork = jest.fn<(params: { cwd: string; message: string; runDir: string }) => Promise<{ committed: boolean } | QueueFailure>>();

jest.mock('#src/queue/createTicketWorktree.ts', () => ({ createTicketWorktree: (params: { branch: string }) => mockCreateTicketWorktree(params) }));
jest.mock('#src/queue/tracker/index.ts', () => ({
	setTicketStatus: (params: { statusName: string }) => mockSetTicketStatus(params),
	appendTicketNote: () => Promise.resolve(undefined),
}));
jest.mock('#src/queue/runWorkerWithRelay.ts', () => ({ runWorkerWithRelay: () => mockRunWorkerWithRelay() }));
jest.mock('#src/queue/commitTicketWork.ts', () => ({
	commitTicketWork: (params: { cwd: string; message: string; runDir: string }) => mockCommitTicketWork(params),
}));
// -------------------------

const settings = queueSettingsFixture();

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	route: QueueRoute.Direct,
};

/** The ticket run with every step stubbed green, so each test only has to change the one it is about. */
const setupTicketRun = () => {
	const progress: string[] = [];
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-ticket-'));

	mockCreateTicketWorktree.mockResolvedValue('/tmp/worktrees/lo-70-drain-the-backlog');
	mockSetTicketStatus.mockResolvedValue(undefined);
	mockRunWorkerWithRelay.mockResolvedValue({});
	mockCommitTicketWork.mockResolvedValue({ committed: true });

	const relay = new TerminalQuestionRelay({ settings, input: new PassThrough(), output: new PassThrough() });

	const run = () =>
		runQueueTicket({
			cwd: '/tmp/repo',
			settings,
			ticket,
			config,
			driver,
			driverName: 'claude-code',
			defaultBranch: 'main',
			relay,
			serializeWorktreeAdd: (task) => task(),
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			onProgress: (message) => progress.push(message),
		});

	return { run, relay, coordinatorRunDir, progress };
};

describe('runQueueTicket', () => {
	test('renders the branch, makes the worktree, marks the ticket in progress, and ends on a commit', async () => {
		const { run, relay, coordinatorRunDir } = setupTicketRun();

		const outcome = await run();

		relay.close();

		expect(outcome).toStrictEqual({ ticket, branch: 'lo-70-drain-the-backlog', worktreePath: '/tmp/worktrees/lo-70-drain-the-backlog', ready: true });
		expect(mockSetTicketStatus).toHaveBeenCalledWith(expect.objectContaining({ statusName: 'In Progress' }));
		expect(mockCommitTicketWork).toHaveBeenCalledWith({
			cwd: '/tmp/worktrees/lo-70-drain-the-backlog',
			message: 'LO-70 Drain the backlog',
			runDir: join(coordinatorRunDir, 'tickets', 'LO-70'),
		});
	});

	test('sends worktree creation through the queue’s serializer, because that step mutates the main checkout', async () => {
		const { run, relay } = setupTicketRun();
		const serialized: string[] = [];

		mockCreateTicketWorktree.mockImplementation(({ branch }) => {
			serialized.push(branch);

			return Promise.resolve('/tmp/worktrees/lo-70-drain-the-backlog');
		});

		await run();
		relay.close();

		expect(serialized).toStrictEqual(['lo-70-drain-the-backlog']);
	});

	test('ends the ticket when its worktree cannot be made, without asking the tracker or spawning a worker', async () => {
		const { run, relay } = setupTicketRun();

		mockCreateTicketWorktree.mockResolvedValue({ error: 'git refused' });

		const outcome = await run();

		relay.close();

		expect(outcome).toEqual(expect.objectContaining({ ready: false, error: 'git refused' }));
		expect(mockSetTicketStatus).not.toHaveBeenCalled();
		expect(mockRunWorkerWithRelay).not.toHaveBeenCalled();
	});

	test('keeps building when the tracker will not take the status — it is a courtesy to whoever is watching, not a precondition', async () => {
		const { run, relay, progress } = setupTicketRun();

		mockSetTicketStatus.mockResolvedValue({ error: "the 'LO' team has no 'In Progress' status" });

		const outcome = await run();

		relay.close();

		expect(outcome.ready).toBe(true);
		expect(progress).toEqual([expect.stringContaining('could not be moved')]);
	});

	test('parks without committing when the worker stopped, so the ship step never sees a branch nothing vouches for', async () => {
		const { run, relay } = setupTicketRun();

		mockRunWorkerWithRelay.mockResolvedValue({ error: 'tsc: 3 errors' });

		const outcome = await run();

		relay.close();

		expect(outcome).toEqual(expect.objectContaining({ ready: false, error: 'tsc: 3 errors' }));
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test('parks when the commit itself could not be made, carrying git’s own words', async () => {
		const { run, relay } = setupTicketRun();

		mockCommitTicketWork.mockResolvedValue({ error: 'git could not stage the work' });

		expect((await run()).error).toBe('git could not stage the work');

		relay.close();
	});

	test('parks a ticket the worker left untouched, rather than shipping a branch with nothing on it', async () => {
		const { run, relay } = setupTicketRun();

		mockCommitTicketWork.mockResolvedValue({ committed: false });

		expect(await run()).toEqual(expect.objectContaining({ ready: false, error: 'the worker changed nothing' }));

		relay.close();
	});
});

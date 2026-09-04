import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { BranchPhase, type LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/index.ts';
import { runQueueTicket } from '#src/queue/runQueueTicket.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

interface CommitTicketWorkParams {
	cwd: string;
	message: string;
	runDir: string;
	generated: string[] | undefined;
	onProgress?: (message: string) => void;
}

// Mocked Imports
// -------------------------
// Each step this sequence calls is covered by its own tests; what this file owns
// is the order they run in, and which of them decides the ticket is not ready.
const mockCreateTicketWorktree = jest.fn<(params: { branch: string }) => Promise<string | QueueFailure>>();
const mockSetTicketStatus = jest.fn<(params: { statusName: string }) => Promise<QueueFailure | undefined>>();
const mockRunWorkerWithRelay = jest.fn<() => Promise<WorkerOutcome>>();
const mockCommitTicketWork = jest.fn<(params: CommitTicketWorkParams) => Promise<{ committed: boolean } | QueueFailure>>();
const mockReadGitCommitsAhead = jest.fn<(params: { cwd: string; defaultBranch: string }) => Promise<number | undefined>>();

jest.mock('#src/queue/createTicketWorktree.ts', () => ({ createTicketWorktree: (params: { branch: string }) => mockCreateTicketWorktree(params) }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	setTicketStatus: (params: { statusName: string }) => mockSetTicketStatus(params),
	appendTicketNote: () => Promise.resolve(undefined),
}));
jest.mock('#src/queue/runWorkerWithRelay.ts', () => ({ runWorkerWithRelay: () => mockRunWorkerWithRelay() }));
jest.mock('#src/queue/commitTicketWork.ts', () => ({
	commitTicketWork: (params: CommitTicketWorkParams) => mockCommitTicketWork(params),
}));
jest.mock('#src/common/git/readGitCommitsAhead.ts', () => ({
	readGitCommitsAhead: (params: { cwd: string; defaultBranch: string }) => mockReadGitCommitsAhead(params),
}));
// -------------------------

const settings = queueSettingsFixture();
const trackerSettings = trackerSettingsFixture();

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false }, generated: ['plugin/dist/'] };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticket: RunnableTicket = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	unfinishedBlockers: [],
};

/**
 * The ticket run with every step stubbed green, so each test only has to change
 * the one it is about.
 *
 * `cwd` is a real directory because the branch-state record is written into it,
 * and reading that record back is how the phase assertions are made.
 */
const setupTicketRun = () => {
	const progress: string[] = [];
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-repo-'));
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-ticket-'));

	mockCreateTicketWorktree.mockResolvedValue('/tmp/worktrees/lo-70-drain-the-backlog');
	mockSetTicketStatus.mockResolvedValue(undefined);
	mockRunWorkerWithRelay.mockResolvedValue({});
	mockCommitTicketWork.mockResolvedValue({ committed: true });
	mockReadGitCommitsAhead.mockResolvedValue(1);

	const relay = new TerminalQuestionRelay({ settings, trackerSettings, input: new PassThrough(), output: new PassThrough() });

	const run = ({ ticket: given = ticket }: { ticket?: RunnableTicket } = {}) =>
		runQueueTicket({
			cwd,
			settings,
			trackerSettings,
			ticket: given,
			config,
			driver,
			driverName: 'claude-code',
			defaultBranch: 'main',
			relay,
			serializeWorktreeAdd: ({ task }) => task(),
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			onProgress: (message) => progress.push(message),
		});

	return { run, relay, cwd, coordinatorRunDir, progress };
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
			// The commit step is what keeps build output off the branch, so it is
			// handed the config's generated paths and the run's progress sink.
			generated: ['plugin/dist/'],
			onProgress: expect.any(Function),
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

	test('parks the ticket before its worker touches source when the tracker will not take the status — required state is recorded before ownership begins', async () => {
		const { run, relay } = setupTicketRun();

		mockSetTicketStatus.mockResolvedValue({ error: "the 'LO' team has no 'In Progress' status" });

		const outcome = await run();

		relay.close();

		expect(outcome).toEqual(expect.objectContaining({ ready: false, error: expect.stringContaining("could not be moved to 'In Progress'") }));
		expect(mockRunWorkerWithRelay).not.toHaveBeenCalled();
	});

	test('skips the status write when the ticket already holds the target, because a workflow with no self-transition would park every resumed ticket', async () => {
		const { run, relay } = setupTicketRun();

		const outcome = await run({ ticket: { ...ticket, status: 'In Progress' } });

		relay.close();

		expect(mockSetTicketStatus).not.toHaveBeenCalled();
		expect(outcome.ready).toBe(true);
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

	test('records the branch as building before its worker touches source, so a crash leaves the phase written down', async () => {
		const { run, relay, cwd } = setupTicketRun();
		let recordedAtWorkerStart: string | undefined;

		mockRunWorkerWithRelay.mockImplementation(async () => {
			recordedAtWorkerStart = (await readBranchState({ cwd, branch: 'lo-70-drain-the-backlog' }))?.phase;

			return {};
		});

		await run();
		relay.close();

		expect(recordedAtWorkerStart).toBe(BranchPhase.Building);
	});

	test('never writes building over a branch already recorded ready, because pickup is not a reset', async () => {
		const { run, relay, cwd } = setupTicketRun();
		let recordedAtWorkerStart: string | undefined;

		await writeBranchState({ cwd, branch: 'lo-70-drain-the-backlog', phase: BranchPhase.Ready });
		mockRunWorkerWithRelay.mockImplementation(async () => {
			recordedAtWorkerStart = (await readBranchState({ cwd, branch: 'lo-70-drain-the-backlog' }))?.phase;

			return {};
		});

		await run();
		relay.close();

		// Un-recording it here and then failing in the worker would send the next
		// run to re-do finished work.
		expect(recordedAtWorkerStart).toBe(BranchPhase.Ready);
	});

	test('records the branch ready once its commits are on it, which is what the ship step reads', async () => {
		const { run, relay, cwd } = setupTicketRun();

		const outcome = await run();

		relay.close();

		expect(outcome.ready).toBe(true);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain-the-backlog' })).toEqual(expect.objectContaining({ phase: BranchPhase.Ready }));
	});

	test('ships a resumed ticket whose work was committed by an earlier run, rather than reporting that the worker changed nothing', async () => {
		const { run, relay, cwd } = setupTicketRun();

		// This session added nothing, but the branch already carries the work.
		mockCommitTicketWork.mockResolvedValue({ committed: false });
		mockReadGitCommitsAhead.mockResolvedValue(3);

		const outcome = await run();

		relay.close();

		expect(outcome.ready).toBe(true);
		expect(outcome.error).toBeUndefined();
		expect(await readBranchState({ cwd, branch: 'lo-70-drain-the-backlog' })).toEqual(expect.objectContaining({ phase: BranchPhase.Ready }));
	});

	test('parks a ticket whose branch carries no commits at all, leaving the record where the pickup put it', async () => {
		const { run, relay, cwd } = setupTicketRun();

		mockCommitTicketWork.mockResolvedValue({ committed: false });
		mockReadGitCommitsAhead.mockResolvedValue(0);

		expect(await run()).toEqual(expect.objectContaining({ ready: false, error: 'the worker left no commits on the branch' }));

		relay.close();

		expect(await readBranchState({ cwd, branch: 'lo-70-drain-the-backlog' })).toEqual(expect.objectContaining({ phase: BranchPhase.Building }));
	});

	test('parks a ticket whose commits git could not count, and records nothing — an unreadable branch is not a fact worth writing', async () => {
		const { run, relay, cwd } = setupTicketRun();

		mockReadGitCommitsAhead.mockResolvedValue(undefined);

		expect(await run()).toEqual(expect.objectContaining({ ready: false, error: 'git could not count the commits on lo-70-drain-the-backlog' }));

		relay.close();

		expect(await readBranchState({ cwd, branch: 'lo-70-drain-the-backlog' })).toEqual(expect.objectContaining({ phase: BranchPhase.Building }));
	});
});

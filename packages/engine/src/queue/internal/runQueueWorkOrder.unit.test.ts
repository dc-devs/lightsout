import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import type { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { readBranchState } from '#src/queue/branchState/readBranchState.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/internal/common/types/RunnableTicket.ts';
import type { WorkerOutcome } from '#src/queue/internal/common/types/WorkerOutcome.ts';
import { runQueueWorkOrder } from '#src/queue/internal/runQueueWorkOrder.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/TerminalQuestionRelay.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { WorktreeFailure } from '#src/worktree/common/types/WorktreeFailure.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

interface CommitTicketWorkParams {
	cwd: string;
	composeMessage: ({ cwd }: { cwd: string }) => Promise<string>;
	runDir: string;
	generated: string[] | undefined;
	onProgress?: (message: string) => void;
}

interface CreateWorktreeParams {
	cwd: string;
	branch: string;
	startPoint: string;
	setup?: string;
	owner: WorktreeOwner;
	reuseExisting: boolean;
	onProgress?: (message: string) => void;
}

interface RunWorkerWithRelayParams {
	worktreePath: string;
	branch: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	ticket: RunnableTicket;
	config: LightsoutConfig;
	driver: Driver;
	driverName: string;
	env: NodeJS.ProcessEnv;
	relay: QuestionRelay;
	coordinatorRunId: string;
	coordinatorRunDir: string;
	workOrderRunDir: string;
	onProgress?: (message: string) => void;
}

// Mocked Imports
// -------------------------
// Each step this sequence calls is covered by its own tests; what this file owns
// is the order they run in, and which of them decides the ticket is not ready.
const mockCreateWorktree = jest.fn<(params: CreateWorktreeParams) => Promise<string | WorktreeFailure>>();
const mockSetTicketStatus = jest.fn<(params: { statusName: string }) => Promise<QueueFailure | undefined>>();
const mockRunWorkerWithRelay = jest.fn<(params: RunWorkerWithRelayParams) => Promise<WorkerOutcome>>();
const mockCommitTicketWork = jest.fn<(params: CommitTicketWorkParams) => Promise<{ committed: boolean } | QueueFailure>>();
const mockReadGitCommitsAhead = jest.fn<(params: { cwd: string; defaultBranch: string }) => Promise<number | undefined>>();

jest.mock('#src/worktree/createWorktree.ts', () => ({ createWorktree: (params: CreateWorktreeParams) => mockCreateWorktree(params) }));
jest.mock('#src/ticketTracker/appendTicketNote.ts', () => ({ appendTicketNote: () => Promise.resolve(undefined) }));
jest.mock('#src/ticketTracker/setTicketStatus.ts', () => ({ setTicketStatus: (params: { statusName: string }) => mockSetTicketStatus(params) }));
jest.mock('#src/queue/workers/runWorkerWithRelay.ts', () => ({
	runWorkerWithRelay: (params: RunWorkerWithRelayParams) => mockRunWorkerWithRelay(params),
}));
jest.mock('#src/commit/commitWorkOrderWork.ts', () => ({
	commitWorkOrderWork: (params: CommitTicketWorkParams) => mockCommitTicketWork(params),
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
	url: 'https://linear.app/lightsout/issue/LO-70',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	finished: false,
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

	// The branch's phase is recorded in the work order whose record stores it, so
	// the work order exists before the run picks the branch up.
	seedWorkOrderRecord({ cwd, name: 'lo-70-drain-the-backlog', ticketRef: 'LO-70' });
	mockCreateWorktree.mockResolvedValue('/tmp/worktrees/lo-70-drain-the-backlog');
	mockSetTicketStatus.mockResolvedValue(undefined);
	mockRunWorkerWithRelay.mockResolvedValue({});
	mockCommitTicketWork.mockResolvedValue({ committed: true });
	mockReadGitCommitsAhead.mockResolvedValue(1);

	const relay = new TerminalQuestionRelay({ settings, trackerSettings, input: new PassThrough(), output: new PassThrough() });

	// Passed rather than read, so no test mutates the real process environment.
	const env: NodeJS.ProcessEnv = { LINEAR_API_KEY: 'lin_key' };

	const run = ({ ticket: given = ticket }: { ticket?: RunnableTicket } = {}) =>
		runQueueWorkOrder({
			cwd,
			settings,
			trackerSettings,
			// The label and the branch are the same string here: this file is about
			// the sequence, and the prefixed case has its own arrangement below.
			workOrder: { ticket: given, name: 'lo-70-drain-the-backlog', branch: 'lo-70-drain-the-backlog' },
			config,
			driver,
			driverName: 'claude-code',
			defaultBranch: 'main',
			env,
			relay,
			serializeWorktreeAdd: ({ task }) => task(),
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			onProgress: (message) => progress.push(message),
		});

	return { run, relay, cwd, coordinatorRunDir, env, progress };
};

describe('runQueueWorkOrder', () => {
	test('renders the branch, makes the worktree, marks the ticket in progress, and ends on a commit', async () => {
		const { run, relay, coordinatorRunDir } = setupTicketRun();

		const outcome = await run();

		relay.close();

		expect(outcome).toStrictEqual({
			ticket,
			name: 'lo-70-drain-the-backlog',
			branch: 'lo-70-drain-the-backlog',
			worktreePath: '/tmp/worktrees/lo-70-drain-the-backlog',
			ready: true,
		});
		expect(mockSetTicketStatus).toHaveBeenCalledWith(expect.objectContaining({ statusName: 'In Progress' }));
		expect(mockCommitTicketWork).toHaveBeenCalledWith({
			cwd: '/tmp/worktrees/lo-70-drain-the-backlog',
			composeMessage: expect.any(Function),
			runDir: join(coordinatorRunDir, 'work-orders', 'LO-70'),
			// The commit step is what keeps build output off the branch, so it is
			// handed the config's generated paths and the run's progress sink.
			generated: ['plugin/dist/'],
			onProgress: expect.any(Function),
		});
	});

	test('sends worktree creation through the queue’s serializer, because that step mutates the main checkout', async () => {
		const { run, relay } = setupTicketRun();
		const serialized: string[] = [];

		mockCreateWorktree.mockImplementation(({ branch }) => {
			serialized.push(branch);

			return Promise.resolve('/tmp/worktrees/lo-70-drain-the-backlog');
		});

		await run();
		relay.close();

		expect(serialized).toStrictEqual(['lo-70-drain-the-backlog']);
	});

	test("creates the work order's worktree as the queue's, continuing one an earlier drain parked", async () => {
		const { run, relay } = setupTicketRun();

		const outcome = await run();

		relay.close();

		expect(outcome.ready).toBe(true);
		// Reuse on is what lets a drain pick a parked tree back up; the owner is what
		// stops it picking up a tree a standalone run made. The queue composes its own
		// start point, so its trees are still cut from the remote default.
		expect(mockCreateWorktree).toHaveBeenCalledWith(
			expect.objectContaining({ branch: 'lo-70-drain-the-backlog', startPoint: 'origin/main', owner: 'queue', reuseExisting: true }),
		);
	});

	test('ends the ticket when its worktree cannot be made, without asking the tracker or spawning a worker', async () => {
		const { run, relay } = setupTicketRun();

		mockCreateWorktree.mockResolvedValue({ error: 'git refused' });

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

	test("runQueueWorkOrder: parks a ticket whose branch's worktree belongs to a human's plan or implement run", async () => {
		const { run, relay } = setupTicketRun();

		// The queue builds, ships and removes only trees it owns, so a tree another
		// owner's record claims comes back as a creation failure naming that owner.
		mockCreateWorktree.mockResolvedValue({ error: "the worktree at /tmp/worktrees/lo-70-drain-the-backlog belongs to a 'plan' run, so it was left alone" });

		const outcome = await run();

		relay.close();

		expect(outcome).toEqual(expect.objectContaining({ ready: false, error: expect.stringContaining("belongs to a 'plan' run") }));
		expect(mockRunWorkerWithRelay).not.toHaveBeenCalled();
	});

	test("runQueueWorkOrder: records an open ticket's branch open and reports it open without committing", async () => {
		const { run, relay, cwd } = setupTicketRun();

		mockRunWorkerWithRelay.mockResolvedValue({ open: 'plan 002-search-basics is waiting for a ship request' });

		const outcome = await run();

		relay.close();

		expect(outcome).toEqual(
			expect.objectContaining({ ready: false, open: 'plan 002-search-basics is waiting for a ship request', error: undefined, unanswered: undefined }),
		);
		// Every plan the loop built was already committed by the loop, so there is
		// nothing left to commit and no commit count worth reading.
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(mockReadGitCommitsAhead).not.toHaveBeenCalled();
		expect(await readBranchState({ cwd, branch: 'lo-70-drain-the-backlog' })).toEqual(expect.objectContaining({ phase: BranchPhase.Open }));
	});

	test('runQueueWorkOrder: hands the worker the environment and the one ticket run directory', async () => {
		const { run, relay, coordinatorRunDir, env } = setupTicketRun();

		await run();

		relay.close();

		const workOrderRunDir = join(coordinatorRunDir, 'work-orders', 'LO-70');

		// One directory for both: the loop's per-plan commits and this final commit
		// must write their message files to the same place.
		expect(mockRunWorkerWithRelay).toHaveBeenCalledWith(expect.objectContaining({ env, workOrderRunDir }));
		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ runDir: workOrderRunDir }));
	});

	test("runQueueWorkOrder: the final commit's composer names the coordinator run and falls back to the ticket's identifier and title in a tree git cannot read", async () => {
		const { run, relay } = setupTicketRun();

		await run();
		relay.close();
		const [[{ composeMessage }]] = mockCommitTicketWork.mock.calls as [[CommitTicketWorkParams]];

		// Outside any git worktree the staged change cannot be read, so the agent is never asked.
		const message = await composeMessage({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-not-a-repo-')) });

		expect(message).toBe('LO-70 Drain the backlog\n\nlightsout run run-q\n');
	});
	/**
	 * The same sequence handed a work order whose record stores a prefixed branch,
	 * so the label and the branch are two different strings.
	 *
	 * A second factory rather than another parameter on the first: the run is
	 * given a named work order instead of a bare ticket, which is a different
	 * arrangement rather than a variant of the same one.
	 */
	const setupNamedWorkOrderRun = () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-repo-'));
		const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-ticket-'));

		seedWorkOrderRecord({ cwd, name: 'lo-70-drain-the-backlog', branch: 'feature/lo-70-drain-the-backlog', ticketRef: 'LO-70' });
		mockCreateWorktree.mockResolvedValue('/tmp/worktrees/lo-70-drain-the-backlog');
		mockSetTicketStatus.mockResolvedValue(undefined);
		mockRunWorkerWithRelay.mockResolvedValue({});
		mockCommitTicketWork.mockResolvedValue({ committed: true });
		mockReadGitCommitsAhead.mockResolvedValue(1);

		const relay = new TerminalQuestionRelay({ settings, trackerSettings, input: new PassThrough(), output: new PassThrough() });
		const workOrder: NamedWorkOrder = { ticket, name: 'lo-70-drain-the-backlog', branch: 'feature/lo-70-drain-the-backlog' };

		const run = () =>
			runQueueWorkOrder({
				cwd,
				settings,
				trackerSettings,
				workOrder,
				config,
				driver,
				driverName: 'claude-code',
				defaultBranch: 'main',
				env: { LINEAR_API_KEY: 'lin_key' },
				relay,
				serializeWorktreeAdd: ({ task }) => task(),
				coordinatorRunId: 'run-q',
				coordinatorRunDir,
				onProgress: () => {},
			});

		return { run, relay, workOrder };
	};

	test('runs on the branch the record stores and reports the label with it', async () => {
		const { run, relay } = setupNamedWorkOrderRun();

		const outcome = await run();

		relay.close();

		expect(outcome).toEqual(
			expect.objectContaining({
				branch: 'feature/lo-70-drain-the-backlog',
				name: 'lo-70-drain-the-backlog',
				worktreePath: '/tmp/worktrees/lo-70-drain-the-backlog',
				ready: true,
			}),
		);
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature/lo-70-drain-the-backlog' }));
	});
});

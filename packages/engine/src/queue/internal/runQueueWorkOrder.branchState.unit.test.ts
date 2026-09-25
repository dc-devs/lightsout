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
import { writeBranchState } from '#src/queue/branchState/writeBranchState.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
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

/**
 * What a ticket run writes down about its branch's phase, and what it reads
 * back before writing.
 *
 * A sibling of `runQueueWorkOrder.unit.test.ts` rather than more cases in it:
 * that file states the run's own sequence and its outcome, while every case
 * here is about the branch-phase record beside it — the one thing a crashed
 * run leaves behind for the next drain to read.
 */

// Mocked Imports
// -------------------------
// Each step this sequence calls is covered by its own tests; what this file owns
// is the order they run in, and which of them decides the ticket is not ready.
const mockCreateWorktree = jest.fn<(params: CreateWorktreeParams) => Promise<string | WorktreeFailure>>();
const mockSetTicketStatus = jest.fn<(params: { statusName: string }) => Promise<QueueFailure | undefined>>();
const mockRunWorkerWithRelay = jest.fn<(params: RunWorkerWithRelayParams) => Promise<WorkerOutcome>>();
const mockCommitTicketWork = jest.fn<(params: CommitTicketWorkParams) => Promise<{ committed: false } | { committed: true; message: string } | QueueFailure>>();
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
	mockCommitTicketWork.mockResolvedValue({ committed: true, message: 'LO-70: stub subject\n\nlightsout run stub\n' });
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

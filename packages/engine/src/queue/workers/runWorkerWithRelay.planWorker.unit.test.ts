import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type TicketRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/index.ts';
import { runWorkerWithRelay } from '#src/queue/workers/runWorkerWithRelay.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/**
 * How the plan worker decides what to build: the ticket record it pulls first,
 * and what it falls back to when the ticket carries none.
 *
 * A sibling of `runWorkerWithRelay.unit.test.ts` rather than more cases in it:
 * that file states which worker a ticket gets and the loop between a question
 * and its answer, while every case here turns on the record the pull answers.
 */

// Mocked Imports
// -------------------------
// Every build here spawns a harness or a pipeline — another module's entry
// point, each covered by its own tests. What this file owns is the fork between
// them, which is observable with them stubbed.
const mockRunPlanFolderPipeline = jest.fn<(params: { cwd: string; name: string }) => Promise<WorkerOutcome>>();
const mockRunDirectWork = jest.fn<(params: { answeredQuestion?: { question: string; answer: string } }) => Promise<PipelineResult>>();
const mockAppendTicketNote = jest.fn<() => Promise<undefined>>();

jest.mock('#src/queue/workers/runPlanFolderPipeline.ts', () => ({
	runPlanFolderPipeline: (params: { cwd: string; name: string }) => mockRunPlanFolderPipeline(params),
}));
jest.mock('#src/direct/index.ts', () => ({
	runDirectWork: (params: { answeredQuestion?: { question: string; answer: string } }) => mockRunDirectWork(params),
}));
jest.mock('#src/ticketTracker/index.ts', () => ({ appendTicketNote: () => mockAppendTicketNote() }));
// -------------------------
// The plan worker asks the disk whether the folder is there, then asks the ticket
// for the plan when it is not. Only the tracker half is stubbed: whether a
// folder exists is arranged by making one, so `pathExists` stays real and each
// case reads the worktree it actually built.
const mockRestorePlanWorkspace =
	jest.fn<(params: { cwd: string; name: string; identifier: string; settings: TrackerSettings }) => Promise<{ restored: string[]; error?: string }>>();

jest.mock('#src/plan/index.ts', () => ({
	...jest.requireActual<typeof import('#src/plan/index.ts')>('#src/plan/index.ts'),
	restorePlanWorkspace: (params: { cwd: string; name: string; identifier: string; settings: TrackerSettings }) => mockRestorePlanWorkspace(params),
}));
// -------------------------
// Reading the record, and building a ticket's plans one at a time, each have
// their own tests. What this file owns is the fork between them: a record sends
// the ticket to the ordered per-plan build, no record leaves the single
// branch-named build exactly as it was, and a failed pull builds nothing.
interface PullTicketRecordParams {
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type PullTicketRecordResult = { record: TicketRecord | undefined } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullTicketRecordParams) => Promise<PullTicketRecordResult>>();

jest.mock('#src/ticket/index.ts', () => ({ pullTicketRecord: (params: PullTicketRecordParams) => mockPullTicketRecord(params) }));
// -------------------------
interface BuildTicketPlansParams {
	cwd: string;
	branch: string;
	record: TicketRecord;
	env: NodeJS.ProcessEnv;
	driverName: string;
	ticketRunDir: string;
	allowTicketBodyBuild: boolean;
}

const mockBuildTicketPlans = jest.fn<(params: BuildTicketPlansParams) => Promise<WorkerOutcome>>();

jest.mock('#src/queue/workers/buildTicketPlans.ts', () => ({
	buildTicketPlans: (params: BuildTicketPlansParams) => mockBuildTicketPlans(params),
}));
// -------------------------

const settings = queueSettingsFixture();

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticketOf = (worker: QueueWorker): RunnableTicket => ({
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	url: 'https://linear.app/lightsout/issue/LO-70',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
});

const manifestOf = (status: RunStatus): RunManifest => ({
	runId: 'run-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:01.000Z',
	plan: '.lightsout/runs/run-1/ticket.md',
	harness: 'claude-code',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/** A relay on a pair of streams. No case here escalates, so nothing is ever typed back. */
const setupRelay = () => {
	const input = new PassThrough();
	const output = new Writable({
		write(_chunk: Buffer, _encoding, done) {
			done();
		},
	});

	mockAppendTicketNote.mockResolvedValue(undefined);

	return {
		relay: new TerminalQuestionRelay({ settings, trackerSettings: trackerSettingsFixture(), input, output }),
		coordinatorRunDir: mkdtempSync(join(tmpdir(), 'lightsout-plan-worker-')),
	};
};

/**
 * A plan worker on a ticket that carries a published brainstorm and no plan:
 * the worktree has no plan folder, and the fetch answers with nothing restored
 * and no error, which is what a brainstorm-only ticket reads as.
 */
const setupBrainstormOnlyTicket = () => {
	const { relay, coordinatorRunDir } = setupRelay();

	// A ticket with no record is the legacy shape this fallback was written against.
	mockPullTicketRecord.mockResolvedValue({ record: undefined });
	mockRestorePlanWorkspace.mockResolvedValue({ restored: [] });
	mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf(RunStatus.Passed) });

	const progress: string[] = [];

	return {
		relay,
		progress,
		params: {
			// A fresh empty worktree: no plan folder on disk, which is what sends the worker to the ticket.
			worktreePath: mkdtempSync(join(tmpdir(), 'lightsout-brainstorm-only-')),
			branch: 'lo-70-drain',
			ticket: { ...ticketOf(QueueWorker.Plan), planningStatus: PlanningStatus.Complete },
			config,
			driver,
			driverName: 'claude-code',
			settings,
			trackerSettings: trackerSettingsFixture(),
			relay,
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			ticketRunDir: join(coordinatorRunDir, 'tickets', 'LO-70'),
			env: {},
			onProgress: (message: string) => {
				progress.push(message);
			},
		},
	};
};

/** The ticket record the queue pulls before it builds, handed on to the build loop whole. */
const ticketRecord: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-70',
	branch: 'lo-70-drain',
	mode: 'multiple-plan',
	plans: [{ id: '002-drain-order', title: 'Drain order', progress: 'ready', createdAt: '2026-01-02T00:00:00.000Z' }],
	history: [{ at: '2026-01-02T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 002-drain-order' }],
};

/** A plan worker on a fresh empty worktree for branch `lo-70-drain`, with the record pull arranged by the row. */
const setupPlanWorkerTicket = ({ pull }: { pull: PullTicketRecordResult }) => {
	const { relay, coordinatorRunDir } = setupRelay();
	const worktreePath = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const ticketRunDir = join(coordinatorRunDir, 'tickets', 'LO-70');

	mockPullTicketRecord.mockResolvedValue(pull);
	mockBuildTicketPlans.mockResolvedValue({});
	mockRestorePlanWorkspace.mockResolvedValue({ restored: ['plan.md'] });
	mockRunPlanFolderPipeline.mockResolvedValue({});

	return {
		relay,
		ticketRunDir,
		worktreePath,
		params: {
			worktreePath,
			branch: 'lo-70-drain',
			ticket: ticketOf(QueueWorker.Plan),
			config,
			driver,
			driverName: 'claude-code',
			settings,
			trackerSettings: trackerSettingsFixture(),
			relay,
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			ticketRunDir,
			env: { LINEAR_API_KEY: 'key-1' },
		},
	};
};

describe('runWorkerWithRelay', () => {
	test('runWorkerWithRelay: builds a planning-complete ticket carrying only a published brainstorm from the ticket body', async () => {
		const { relay, progress, params } = setupBrainstormOnlyTicket();

		const outcome = await runWorkerWithRelay(params);

		relay.close();

		expect(outcome).toStrictEqual({});
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketBody: 'Build the thing.', ticketRef: 'LO-70', cwd: params.worktreePath }));
		expect(progress).toEqual([expect.stringContaining('carries no published plan')]);
	});

	test('runWorkerWithRelay: a plan-worker ticket with a record is built plan by plan', async () => {
		const { relay, params, ticketRunDir, worktreePath } = setupPlanWorkerTicket({ pull: { record: ticketRecord } });

		const outcome = await runWorkerWithRelay(params);

		relay.close();

		expect(outcome).toStrictEqual({});
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: worktreePath, branch: 'lo-70-drain', record: ticketRecord, ticketRunDir, allowTicketBodyBuild: true }),
		);
		expect(mockRestorePlanWorkspace).not.toHaveBeenCalled();
	});

	test('runWorkerWithRelay: a plan-worker ticket with no record keeps the single branch-named build', async () => {
		const { relay, params, worktreePath } = setupPlanWorkerTicket({ pull: { record: undefined } });

		const outcome = await runWorkerWithRelay(params);

		relay.close();

		expect(outcome).toStrictEqual({});
		expect(mockRestorePlanWorkspace).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktreePath, name: 'lo-70-drain' }));
		expect(mockRunPlanFolderPipeline).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktreePath, name: 'lo-70-drain' }));
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('runWorkerWithRelay: a plan-worker ticket whose published plan cannot be fetched parks', async () => {
		const { relay, params } = setupPlanWorkerTicket({ pull: { record: undefined } });

		mockRestorePlanWorkspace.mockResolvedValue({ restored: [], error: 'LO-70 could not be read: the tracker returned 401' });

		const outcome = await runWorkerWithRelay(params);

		relay.close();

		expect(outcome).toStrictEqual({ error: 'the plan published to LO-70 could not be fetched: LO-70 could not be read: the tracker returned 401' });
		expect(mockRunPlanFolderPipeline).not.toHaveBeenCalled();
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('runWorkerWithRelay: a plan worker whose record pull fails builds nothing', async () => {
		const divergence = 'the ticket record on LO-70 and the local one both moved: resolve them with lightsout ticket sync --name lo-70-drain';
		const { relay, params } = setupPlanWorkerTicket({ pull: { error: divergence } });

		const outcome = await runWorkerWithRelay(params);

		relay.close();

		expect(outcome).toStrictEqual({ error: divergence });
		expect(mockRestorePlanWorkspace).not.toHaveBeenCalled();
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
		expect(mockRunPlanFolderPipeline).not.toHaveBeenCalled();
	});
});

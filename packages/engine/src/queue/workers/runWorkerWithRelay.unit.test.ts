import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type WorkOrderState } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/index.ts';
import { runWorkerWithRelay } from '#src/queue/workers/runWorkerWithRelay.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Every worker spawns a harness or a pipeline — another module's entry point,
// each covered by its own tests. What this file owns is which worker the ticket
// selects and the loop between a worker's question and the answer that comes
// back, which is observable with them stubbed.
const mockRunAutoPlanWorker = jest.fn<(params: { answeredQuestion?: { question: string; answer: string } }) => Promise<WorkerOutcome>>();
const mockRunPlanFolderPipeline = jest.fn<(params: { cwd: string; name: string }) => Promise<WorkerOutcome>>();
const mockRunDirectWork = jest.fn<(params: { answeredQuestion?: { question: string; answer: string } }) => Promise<PipelineResult>>();
const mockAppendTicketNote = jest.fn<() => Promise<undefined>>();

jest.mock('#src/queue/workers/runAutoPlanWorker.ts', () => ({
	runAutoPlanWorker: (params: { answeredQuestion?: { question: string; answer: string } }) => mockRunAutoPlanWorker(params),
}));
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
// Every ticket here carries no ticket record, which is the legacy shape these
// cases were written against, so the pull is stubbed to answer nothing. What a
// record changes is stated in `runWorkerWithRelay.planWorker.unit.test.ts`.
interface PullTicketRecordParams {
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type PullTicketRecordResult = { record: WorkOrderState | undefined } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullTicketRecordParams) => Promise<PullTicketRecordResult>>();

jest.mock('#src/workOrder/index.ts', () => ({ pullWorkOrderState: (params: PullTicketRecordParams) => mockPullTicketRecord(params) }));
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
	commits: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/** A relay on a pair of streams, typing each queued answer as its prompt appears. */
const setupRelay = ({ answers = [] }: { answers?: string[] } = {}) => {
	const input = new PassThrough();
	const queued = [...answers];
	const output = new Writable({
		write(chunk: Buffer, _encoding, done) {
			if (chunk.toString().includes('answer: ')) {
				const next = queued.shift();

				if (next !== undefined) {
					setImmediate(() => input.write(`${next}\n`));
				} else {
					setImmediate(() => input.end());
				}
			}

			done();
		},
	});

	mockAppendTicketNote.mockResolvedValue(undefined);
	// The ordinary ticket here carries no record, which is the legacy shape every
	// case below this one was written against.
	mockPullTicketRecord.mockResolvedValue({ record: undefined });

	return {
		relay: new TerminalQuestionRelay({ settings, trackerSettings: trackerSettingsFixture(), input, output }),
		coordinatorRunDir: mkdtempSync(join(tmpdir(), 'lightsout-worker-')),
	};
};

const runWorker = ({
	relay,
	coordinatorRunDir,
	ticket,
	worktreePath = '/tmp/lo-70-drain',
}: {
	relay: QuestionRelay;
	coordinatorRunDir: string;
	ticket: RunnableTicket;
	worktreePath?: string;
}) =>
	runWorkerWithRelay({
		worktreePath,
		branch: 'lo-70-drain',
		ticket,
		config,
		driver,
		driverName: 'claude-code',
		settings,
		trackerSettings: trackerSettingsFixture(),
		relay,
		coordinatorRunId: 'run-q',
		coordinatorRunDir,
		ticketRunDir: join(coordinatorRunDir, 'tickets', ticket.identifier),
		env: {},
	});

describe('runWorkerWithRelay', () => {
	test('a direct worker that finishes needs no question, and the relay is never used', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf(RunStatus.Passed) });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.Direct) })).toStrictEqual({});

		relay.close();
	});

	test('relays a direct worker’s escalation and re-invokes it with the answer, in the same tree', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['the second one'] });

		mockRunDirectWork
			.mockResolvedValueOnce({ ok: false, manifest: manifestOf(RunStatus.Escalated), error: 'Which one?' })
			.mockResolvedValueOnce({ ok: true, manifest: manifestOf(RunStatus.Passed) });

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.Direct) });

		relay.close();

		expect(outcome).toStrictEqual({});
		expect(mockRunDirectWork).toHaveBeenLastCalledWith(expect.objectContaining({ answeredQuestion: { question: 'Which one?', answer: 'the second one' } }));
	});

	test('parks a direct run that failed for any other reason, carrying the worker’s own error', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Failed), error: 'tsc: 3 errors' });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.Direct) })).toStrictEqual({ error: 'tsc: 3 errors' });

		relay.close();
	});

	test('names the state a run ended in when it stopped without saying why', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.PausedRateLimit) });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.Direct) })).toStrictEqual({ error: 'the run ended paused-rate-limit' });

		relay.close();
	});

	test('an auto-plan worker that reports complete needs no question either', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunAutoPlanWorker.mockResolvedValue({});

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.AutoPlan) })).toStrictEqual({});

		relay.close();
	});

	test('relays an auto-plan worker’s first failure as the question it asked, and folds the answer into the next invocation', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['the second one'] });

		mockRunAutoPlanWorker.mockResolvedValueOnce({ question: 'Which one?' }).mockResolvedValueOnce({});

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.AutoPlan) });

		relay.close();

		expect(outcome).toStrictEqual({});
		expect(mockRunAutoPlanWorker).toHaveBeenLastCalledWith(expect.objectContaining({ answeredQuestion: { question: 'Which one?', answer: 'the second one' } }));
	});

	test('hands the plan folder the plan worker located to the engine-owned build', async () => {
		const { relay, coordinatorRunDir } = setupRelay();
		const worktreePath = mkdtempSync(join(tmpdir(), 'lightsout-plan-worker-'));

		mkdirSync(join(worktreePath, '.lightsout', 'tickets', 'lo-70-drain', 'plans'), { recursive: true });
		writeFileSync(join(worktreePath, '.lightsout', 'tickets', 'lo-70-drain', 'plans', 'plan.md'), '# Plan\n');
		mockRunPlanFolderPipeline.mockResolvedValue({});

		expect(await runWorker({ relay, coordinatorRunDir, worktreePath, ticket: ticketOf(QueueWorker.Plan) })).toStrictEqual({});
		expect(mockRunPlanFolderPipeline).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktreePath, name: 'lo-70-drain' }));

		relay.close();
	});

	test('stops relaying once the answers have run out, rather than asking the user forever', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['first', 'second', 'third', 'fourth'] });

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Escalated), error: 'Which one?' });

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.Direct) });

		relay.close();

		expect(outcome).toEqual({ error: expect.stringContaining('still asking after') });
		expect(mockRunDirectWork).toHaveBeenCalledTimes(3);
	});

	test('parks the ticket when there is no terminal to relay to, and marks the park unanswered — that is the one that retires a drain slot', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Escalated), error: 'Which one?' });

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueWorker.Direct) });

		relay.close();

		expect(outcome).toEqual({ error: expect.stringContaining('could not be relayed'), unanswered: true });
	});
});

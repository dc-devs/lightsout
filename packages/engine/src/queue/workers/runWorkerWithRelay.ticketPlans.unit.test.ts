import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, PlanProgress, WorkOrderEventKind, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { runWorkerWithRelay } from '#src/queue/workers/runWorkerWithRelay.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/**
 * What the plan worker answers when the ticket's own ordered build stops before
 * it builds anything: the sentence naming the repair a human makes.
 *
 * A sibling of `runWorkerWithRelay.planWorker.unit.test.ts` rather than more
 * cases in it: that file stubs the ordered build to state which build a record
 * sends the ticket to, while every case here leaves the ordered build real so
 * the sentence a caller actually reads is the one asserted.
 */

// Mocked Imports
// -------------------------
// Only the record pull is stubbed: it is the one call that would leave the
// machine. The implementation order rules stay real, so the sentence the worker
// answers with is the one the rules themselves compose.
interface PullTicketRecordParams {
	cwd: string;
	workOrderName: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

const mockPullTicketRecord = jest.fn<(params: PullTicketRecordParams) => Promise<{ record: WorkOrderState | undefined } | { error: string }>>();

jest.mock('#src/workOrder/index.ts', () => ({
	...jest.requireActual<typeof import('#src/workOrder/index.ts')>('#src/workOrder/index.ts'),
	pullWorkOrderState: (params: PullTicketRecordParams) => mockPullTicketRecord(params),
}));
// -------------------------
// Whether the worktree holds uncommitted work is git's answer, and no case here
// is about leftover work: a clean tree keeps every case on the ordered build.
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({
	readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch every plan below implements on. */
const branch = 'lo-7-search';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticket: RunnableTicket = {
	id: 'id-7',
	identifier: 'LO-7',
	title: 'Search the plans',
	url: 'https://linear.app/lightsout/issue/LO-7',
	description: 'Build search.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Plan,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
};

/** Plan 001, already built, so the loop walks past it to the plan each case is about. */
const firstImplemented: WorkOrderPlan = {
	id: '001-search-index',
	title: 'Search index',
	progress: PlanProgress.Implemented,
	createdAt: '2026-01-01T00:00:00.000Z',
	implementation: { runId: 'run-1', startedAt: '2026-01-02T00:00:00.000Z', startCommit: 'a1b2c3', finishedAt: '2026-01-03T00:00:00.000Z' },
};

/**
 * A plan worker on a ticket whose record the pull answers with, built in a
 * worktree with nothing uncommitted in it.
 *
 * `runId` is what separates the two stalled cases: a plan whose run was recorded
 * can be finished with `lightsout resume`, and one whose run was not has only
 * the other repair path.
 */
const setupOrderedBuild = ({ progress, runId }: { progress: PlanProgress; runId?: string }) => {
	const second: WorkOrderPlan = {
		id: '002-search-basics',
		title: 'Search basics',
		progress,
		createdAt: '2026-01-01T00:00:00.000Z',
		...(runId === undefined ? {} : { implementation: { runId, startedAt: '2026-01-02T00:00:00.000Z', startCommit: 'd4e5f6' } }),
	};
	const record: WorkOrderState = {
		schemaVersion: 1,
		ticketRef: 'LO-7',
		branch,
		mode: WorkOrderMode.MultiplePlan,
		plans: [firstImplemented, second],
		history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added the first plan' }],
	};

	mockPullTicketRecord.mockResolvedValue({ record });
	mockReadGitChangedFiles.mockResolvedValue([]);

	const ask = jest.fn<(params: { question: string; ticket: TicketSummary; coordinatorRunId: string; coordinatorRunDir: string }) => Promise<string>>();
	const relay: QuestionRelay = { ask, createProgressSink: () => () => undefined, close: () => undefined };
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-ordered-build-'));

	return {
		ask,
		params: {
			worktreePath: mkdtempSync(join(tmpdir(), 'lightsout-ticket-plans-')),
			branch,
			ticket,
			config,
			driver,
			driverName: 'claude-code',
			settings: queueSettingsFixture(),
			trackerSettings: trackerSettingsFixture(),
			relay,
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			workOrderRunDir: join(coordinatorRunDir, 'work-orders', 'LO-7'),
			env: { LINEAR_API_KEY: 'key-1' },
		},
	};
};

describe('runWorkerWithRelay', () => {
	test('runWorkerWithRelay: a plan whose implementation has not finished parks the ticket naming both repair paths', async () => {
		const { ask, params } = setupOrderedBuild({ progress: PlanProgress.Implementing, runId: 'run-4' });

		const outcome = await runWorkerWithRelay(params);

		// the park is an error rather than a question: a stalled plan is a human's
		// to repair, and nothing the relay could ask would move it on
		expect(outcome.question).toBeUndefined();
		expect(outcome.error).toEqual(expect.stringContaining('lightsout work-order exclude-plan --name lo-7-search --plan 002-search-basics'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-4'));
		expect(outcome.error).not.toEqual(expect.stringContaining('lightsout ticket '));
		expect(ask).not.toHaveBeenCalled();
	});

	test('runWorkerWithRelay: a failed plan with no run recorded parks naming only the exclude-plan repair', async () => {
		const { params } = setupOrderedBuild({ progress: PlanProgress.Failed });

		const outcome = await runWorkerWithRelay(params);

		expect(outcome.error).toEqual(expect.stringContaining('lightsout work-order exclude-plan --name lo-7-search --plan 002-search-basics'));
		expect(outcome.error).not.toEqual(expect.stringContaining('lightsout resume'));
		expect(outcome.error).not.toEqual(expect.stringContaining('lightsout ticket '));
	});

	test('runWorkerWithRelay: a plan still being planned is not stalled, so the ticket is left open rather than parked', async () => {
		const { params } = setupOrderedBuild({ progress: PlanProgress.Planning });

		const outcome = await runWorkerWithRelay(params);

		expect(outcome.error).toBeUndefined();
		expect(outcome.open).toEqual(expect.stringContaining('002-search-basics'));
	});
});

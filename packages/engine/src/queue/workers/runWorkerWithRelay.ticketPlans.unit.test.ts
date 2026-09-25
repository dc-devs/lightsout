import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { RunnableTicket } from '#src/queue/internal/common/types/RunnableTicket.ts';
import { runWorkerWithRelay } from '#src/queue/workers/runWorkerWithRelay.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

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

jest.mock('#src/workOrder/pullWorkOrderState.ts', () => ({ pullWorkOrderState: (params: PullTicketRecordParams) => mockPullTicketRecord(params) }));
// -------------------------
// Whether the worktree holds uncommitted work is git's answer: a clean tree
// keeps a case on the ordered build, and each leftover case arms it with the
// source path it parks over or commits. The commit itself stays real.
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({
	readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params),
}));
// -------------------------

/** The work order's label: the folder its plans live under, and the name every remedy below takes. */
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
 * Plan 002, the plan every case below is about.
 *
 * `runId` is what separates the two stalled cases: a plan whose run was recorded
 * can be finished with `lightsout resume`, and one whose run was not has only
 * the other repair path.
 */
const secondPlan = ({ progress, runId }: { progress: PlanProgress; runId?: string }): WorkOrderPlan => ({
	id: '002-search-basics',
	title: 'Search basics',
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(runId === undefined ? {} : { implementation: { runId, startedAt: '2026-01-02T00:00:00.000Z', startCommit: 'd4e5f6' } }),
});

/**
 * A plan worker on a ticket whose record the pull answers with.
 *
 * `workOrderBranch` is the git branch alone: a row that hands it a prefixed
 * branch keeps the label `lo-7-search`, so a sentence composed from the wrong
 * field reads differently and the row catches it.
 */
const setupWorker = ({
	plans,
	workOrderBranch = branch,
	leftover = [],
	answer,
}: {
	plans: WorkOrderPlan[];
	workOrderBranch?: string;
	leftover?: string[];
	/**
	 * The final text the worker's driver answers every invocation with. Given, the
	 * worktree is a real repo holding each `leftover` path as an uncommitted file,
	 * so the leftover commit is actually made; without one it is a directory git
	 * cannot read, and the driver answers nothing.
	 */
	answer?: string;
}) => {
	const record: WorkOrderState = {
		schemaVersion: 1,
		name: branch,
		ticketRef: 'LO-7',
		branch: workOrderBranch,
		mode: WorkOrderMode.MultiplePlan,
		plans,
		history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added the first plan' }],
	};

	mockPullTicketRecord.mockResolvedValue({ record });
	mockReadGitChangedFiles.mockResolvedValue(leftover);

	const ask = jest.fn<(params: { question: string; ticket: TicketSummary; coordinatorRunId: string; coordinatorRunDir: string }) => Promise<string>>();
	const relay: QuestionRelay = { ask, createProgressSink: () => () => undefined, close: () => undefined };
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-ordered-build-'));
	const worktreePath = answer === undefined ? mkdtempSync(join(tmpdir(), 'lightsout-ticket-plans-')) : setupConsumerRepo();
	const invocations: DriverInvocation[] = [];
	const answering: Driver = {
		name: 'claude-code',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text: answer ?? '', exitCode: 0 };
		},
	};

	if (answer !== undefined) {
		for (const path of leftover) {
			writeRepoFile({ cwd: worktreePath, path, content: 'export const searchIndex = new Map<string, string>();\n' });
		}
	}

	return {
		ask,
		invocations,
		params: {
			worktreePath,
			workOrderName: branch,
			ticket,
			config,
			driver: answer === undefined ? driver : answering,
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
		const { ask, params } = setupWorker({ plans: [firstImplemented, secondPlan({ progress: PlanProgress.Implementing, runId: 'run-4' })] });

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
		const { params } = setupWorker({ plans: [firstImplemented, secondPlan({ progress: PlanProgress.Failed })] });

		const outcome = await runWorkerWithRelay(params);

		expect(outcome.error).toEqual(expect.stringContaining('lightsout work-order exclude-plan --name lo-7-search --plan 002-search-basics'));
		expect(outcome.error).not.toEqual(expect.stringContaining('lightsout resume'));
		expect(outcome.error).not.toEqual(expect.stringContaining('lightsout ticket '));
	});

	test('runWorkerWithRelay: a plan still being planned is not stalled, so the ticket is left open rather than parked', async () => {
		const { params } = setupWorker({ plans: [firstImplemented, secondPlan({ progress: PlanProgress.Planning })] });

		const outcome = await runWorkerWithRelay(params);

		expect(outcome.error).toBeUndefined();
		expect(outcome.open).toEqual(expect.stringContaining('002-search-basics'));
	});

	test('runWorkerWithRelay: a stalled plan is named by the work order label, not by its prefixed branch', async () => {
		const { params } = setupWorker({
			plans: [firstImplemented, secondPlan({ progress: PlanProgress.Failed })],
			workOrderBranch: 'feature/lo-7-search',
		});

		const outcome = await runWorkerWithRelay(params);

		// both halves of the sentence are the label: the work order a human is told
		// about, and the `--name` value of the command they are handed to repair it
		expect(outcome.error).toEqual(expect.stringContaining('on work order lo-7-search has not finished'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout work-order exclude-plan --name lo-7-search --plan 002-search-basics'));
		expect(outcome.error).not.toEqual(expect.stringContaining('feature/'));
	});

	test('runWorkerWithRelay: leftover work no implemented plan owns parks the ticket naming the work order label', async () => {
		const { params } = setupWorker({
			plans: [secondPlan({ progress: PlanProgress.Ready })],
			workOrderBranch: 'feature/lo-7-search',
			leftover: ['packages/engine/src/search/readIndex.ts'],
		});

		const outcome = await runWorkerWithRelay(params);

		// no plan of this work order has finished implementing, so the changes
		// already in the tree belong to nobody and nothing may be committed
		expect(outcome.error).toEqual(expect.stringContaining('no implemented plan of work order lo-7-search accounts for'));
		expect(outcome.error).not.toEqual(expect.stringContaining('feature/'));
	});

	test("runWorkerWithRelay: leftover work is committed under the ticket and the agent's summary, with its plan and run in the body", async () => {
		const { params, invocations } = setupWorker({
			plans: [firstImplemented, secondPlan({ progress: PlanProgress.Planning })],
			leftover: ['src/searchIndex.ts'],
			answer: JSON.stringify({ summary: 'index the plans for search' }),
		});

		const outcome = await runWorkerWithRelay(params);

		// the leftover belongs to plan 001, the one implemented plan, so the body
		// names that plan and the run recorded against it, and the loop then reaches
		// plan 002 and leaves the ticket open on it
		const headMessage = execSync('git log -1 --pretty=%B', { cwd: params.worktreePath }).toString().trimEnd();

		expect({ error: outcome.error, open: outcome.open, headMessage, asked: invocations.length }).toEqual({
			error: undefined,
			open: expect.stringContaining('002-search-basics'),
			headMessage: 'LO-7: index the plans for search\n\nlightsout plan 001-search-index\nlightsout run run-1',
			asked: 1,
		});
	});

	test('runWorkerWithRelay: leftover work git cannot stage parks the ticket naming the owning plan and the work order label', async () => {
		const { params } = setupWorker({
			plans: [firstImplemented, secondPlan({ progress: PlanProgress.Planning })],
			leftover: ['src/searchIndex.ts'],
		});

		const outcome = await runWorkerWithRelay(params);

		expect(outcome.error).toEqual(
			expect.stringContaining('plan 001-search-index on work order lo-7-search was built, but its work could not be committed: git could not stage the work'),
		);
	});
});

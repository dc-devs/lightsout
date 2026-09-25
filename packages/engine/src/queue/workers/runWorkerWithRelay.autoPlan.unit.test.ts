import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkReport } from '#src/contracts/work/WorkReport.ts';
import { WorkReportStatus } from '#src/contracts/work/WorkReportStatus.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runWorkerWithRelay } from '#src/queue/workers/runWorkerWithRelay.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/**
 * The auto-plan worker as the queue reaches it: which plan the engine picks
 * before a session starts, and what the worker does with the record it reads
 * again once the session has ended.
 *
 * A sibling of `runWorkerWithRelay.unit.test.ts` rather than more cases in it:
 * that file stubs the auto-plan worker whole to state which worker a ticket
 * gets, while every case here needs the engine's own choice of plan to run for
 * real — the record the pull answers is what decides the address the session is
 * handed.
 */

// Mocked Imports
// -------------------------
// The planning session spawns a harness, and the ordered per-plan build runs
// pipelines against a real repository — each covered by its own tests. Stubbing
// the pair leaves the engine's plan choice and the worker's handling of the
// record as the only things these cases exercise.
const mockInvokeAgentWithContract = jest.fn<(params: { invocation: { prompt: string } }) => Promise<AgentOutcome<WorkReport>>>();

jest.mock('#src/invoke/index.ts', () => ({
	invokeAgentWithContract: (params: { invocation: { prompt: string } }) => mockInvokeAgentWithContract(params),
}));
// -------------------------
interface BuildTicketPlansParams {
	cwd: string;
	workOrderName: string;
	record: WorkOrderState;
	allowTicketBodyBuild: boolean;
}

const mockBuildTicketPlans = jest.fn<(params: BuildTicketPlansParams) => Promise<WorkerOutcome>>();

jest.mock('#src/queue/workers/buildWorkOrderPlans.ts', () => ({
	buildWorkOrderPlans: (params: BuildTicketPlansParams) => mockBuildTicketPlans(params),
}));
// -------------------------
// Only the two ticket operations that leave the machine are stubbed. The rule
// that names the next plan to plan stays real, so the order the engine picks in
// is pinned here rather than arranged.
interface PullParams {
	cwd: string;
	name: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type PullResult = { record: WorkOrderState | undefined } | { error: string };

interface AddPlanParams {
	cwd: string;
	name: string;
	slug: string;
	title?: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type AddPlanResult = { address: string; record: WorkOrderState; notice?: string; publishError?: string } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullParams) => Promise<PullResult>>();
const mockAddTicketPlan = jest.fn<(params: AddPlanParams) => Promise<AddPlanResult>>();

jest.mock('#src/workOrder/index.ts', () => ({
	...jest.requireActual<typeof import('#src/workOrder/index.ts')>('#src/workOrder/index.ts'),
	pullWorkOrderState: (params: PullParams) => mockPullTicketRecord(params),
	addWorkOrderPlan: (params: AddPlanParams) => mockAddTicketPlan(params),
}));
// -------------------------

const branch = 'lo-70-drain';
const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
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
	planningStatus: PlanningStatus.ReadyAutoPlan,
	worker: QueueWorker.AutoPlan,
	status: 'Backlog',
	finished: false,
	unfinishedBlockers: [],
};

const recordWith = ({ plans }: { plans: WorkOrderState['plans'] }): WorkOrderState => ({
	schemaVersion: 1,
	name: branch,
	ticketRef: 'LO-70',
	branch,
	mode: 'multiple-plan',
	plans,
	history: [],
});

/** A ticket already holding plans: 001 built, 002 taken out of the order, and 003 the one nobody has finished planning. */
const recordBeforePlanning = recordWith({
	plans: [
		{ id: '001-drain-basics', title: 'Drain basics', progress: 'implemented', createdAt: '2026-01-01T00:00:00.000Z' },
		{
			id: '002-dropped',
			title: 'Dropped',
			progress: 'planning',
			createdAt: '2026-01-02T00:00:00.000Z',
			exclusion: { at: '2026-01-03T00:00:00.000Z', reason: 'folded into 003', implementationRemoved: false },
		},
		{ id: '003-drain-order', title: 'Drain order', progress: 'planning', createdAt: '2026-01-02T00:00:00.000Z' },
	],
});

/** The same ticket after the session published plan 003, which is what the pull after the session answers. */
const recordAfterPlanning = recordWith({
	plans: recordBeforePlanning.plans.map((plan) => (plan.id === '003-drain-order' ? { ...plan, progress: 'ready' } : plan)),
});

/**
 * A relay nothing is expected to reach: an auto-plan session that finishes
 * asks nobody anything, so a question arriving here is the case failing rather
 * than a question to answer.
 */
const relayThatIsNeverAsked = (): QuestionRelay => ({
	ask: () => Promise.reject(new Error('the auto-plan worker was not expected to ask a question')),
	createProgressSink: () => () => undefined,
	close: () => undefined,
});

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'planned it',
	failures: [],
	...overrides,
});

/**
 * An auto-plan ticket in a real worktree, with the record the engine's choice
 * reads first and the record it reads again once the session has ended.
 *
 * The folder for `planFolder` is made on disk because the worker asks the tree,
 * not a stub, whether the session left a plan where it was told to.
 */
const setupAutoPlanTicket = ({
	chosenPull = { record: recordBeforePlanning },
	plannedPull = { record: recordAfterPlanning },
	added = { error: 'addWorkOrderPlan was not expected to run' },
	planFolder = `${branch}/003-drain-order`,
}: {
	chosenPull?: PullResult;
	plannedPull?: PullResult;
	added?: AddPlanResult;
	planFolder?: string;
} = {}) => {
	const worktreePath = mkdtempSync(join(tmpdir(), 'lightsout-auto-plan-relay-'));
	const folder = planWorkspaceFolder({ cwd: worktreePath, name: planFolder });
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-auto-plan-run-'));
	const progress: string[] = [];

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'plan.md'), '# The plan\n');

	mockPullTicketRecord.mockResolvedValueOnce(chosenPull).mockResolvedValue(plannedPull);
	mockAddTicketPlan.mockResolvedValue(added);
	mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report: reportOf() });
	mockBuildTicketPlans.mockResolvedValue({});

	return {
		progress,
		worktreePath,
		params: {
			worktreePath,
			workOrderName: branch,
			ticket,
			config,
			driver,
			driverName: 'claude-code',
			settings: queueSettingsFixture(),
			trackerSettings: trackerSettingsFixture(),
			relay: relayThatIsNeverAsked(),
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			workOrderRunDir: join(coordinatorRunDir, 'work-orders', 'LO-70'),
			env: { LINEAR_API_KEY: 'key-1' } as NodeJS.ProcessEnv,
			onProgress: (message: string) => progress.push(message),
		},
	};
};

describe('runWorkerWithRelay', () => {
	test('runWorkerWithRelay: an auto-plan session is handed the lowest plan of the ticket still being planned', async () => {
		const { params, worktreePath } = setupAutoPlanTicket();

		const outcome = await runWorkerWithRelay(params);

		expect(outcome).toStrictEqual({});
		// the excluded 002 is passed over, and the session is told the address
		// rather than left to derive a name of its own
		expect(mockInvokeAgentWithContract.mock.calls[0]?.[0].invocation.prompt).toContain(`${branch}/003-drain-order`);
		expect(mockAddTicketPlan).not.toHaveBeenCalled();
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: worktreePath, workOrderName: branch, record: recordAfterPlanning, allowTicketBodyBuild: false }),
		);
	});

	test('runWorkerWithRelay: an auto-plan ticket whose record holds no plans yet has plan 001 created and every notice announced', async () => {
		const firstPlan = recordWith({
			plans: [{ id: '001-drain-the-backlog', title: 'Drain the backlog', progress: 'planning', createdAt: '2026-01-01T00:00:00.000Z' }],
		});
		// A record holding no plans is the state every work order `work-order new`
		// writes is in; a work order with no record at all is now a refusal.
		const { params, progress } = setupAutoPlanTicket({
			chosenPull: { record: recordWith({ plans: [] }) },
			added: {
				address: `${branch}/001-drain-the-backlog`,
				record: firstPlan,
				notice: 'the pending ship request was withdrawn because plan 001-drain-the-backlog was added',
				publishError: 'the record could not be published to LO-70: the tracker refused it',
			},
			planFolder: `${branch}/001-drain-the-backlog`,
		});

		const outcome = await runWorkerWithRelay(params);

		expect(outcome).toStrictEqual({});
		expect(mockAddTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ name: branch, slug: 'drain-the-backlog', title: 'Drain the backlog' }));
		expect(progress).toEqual(expect.arrayContaining([expect.stringContaining('ship request was withdrawn'), expect.stringContaining('tracker refused it')]));
		expect(mockInvokeAgentWithContract.mock.calls[0]?.[0].invocation.prompt).toContain(`${branch}/001-drain-the-backlog`);
	});

	test('runWorkerWithRelay: an auto-plan ticket whose record pull after the session fails builds nothing', async () => {
		const diverged = 'the ticket record on LO-70 and the local one both moved: resolve them with lightsout work-order sync --name lo-70-drain';
		const { params } = setupAutoPlanTicket({ plannedPull: { error: diverged } });

		const outcome = await runWorkerWithRelay(params);

		expect(outcome).toStrictEqual({ error: diverged });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('runWorkerWithRelay: an auto-plan ticket whose record is gone after the session parks naming the plan', async () => {
		const { params } = setupAutoPlanTicket({ plannedPull: { record: undefined } });

		const outcome = await runWorkerWithRelay(params);

		expect(outcome.open).toBeUndefined();
		expect(outcome.error).toEqual(expect.stringContaining(`${branch}/003-drain-order`));
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});
});

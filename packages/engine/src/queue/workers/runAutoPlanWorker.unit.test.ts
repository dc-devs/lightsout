import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, type WorkOrderState, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runAutoPlanWorker } from '#src/queue/workers/runAutoPlanWorker.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Mocked Imports
// -------------------------
// The planning session spawns a harness, the choice reads the ticket record and
// the build loop runs pipelines — each covered by its own tests. What this file
// owns is the seam between them: which plan the session is handed, what its
// report means, and whether the ordered build is handed over at all. The one
// thing read out of the harness call here is the plan address the invocation
// carries, so the real invocation builder still runs.
interface InvokeCall {
	invocation: { prompt: string };
}

const mockInvokeAgentWithContract = jest.fn<(params: InvokeCall) => Promise<AgentOutcome<WorkReport>>>();

jest.mock('#src/invoke/index.ts', () => ({
	invokeAgentWithContract: (params: InvokeCall) => mockInvokeAgentWithContract(params),
}));
// -------------------------
interface ChooseAutoPlanTargetParams {
	cwd: string;
	branch: string;
	ticket: TicketSummary;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type ChooseAutoPlanTargetResult = { record: WorkOrderState; address?: string } | { error: string };

const mockChooseAutoPlanTarget = jest.fn<(params: ChooseAutoPlanTargetParams) => Promise<ChooseAutoPlanTargetResult>>();

jest.mock('#src/queue/workers/chooseAutoPlanTarget.ts', () => ({
	chooseAutoPlanTarget: (params: ChooseAutoPlanTargetParams) => mockChooseAutoPlanTarget(params),
}));
// -------------------------
interface PullTicketRecordParams {
	cwd: string;
	workOrderName: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type PullTicketRecordResult = { record: WorkOrderState | undefined } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullTicketRecordParams) => Promise<PullTicketRecordResult>>();

jest.mock('#src/workOrder/index.ts', () => ({ pullWorkOrderState: (params: PullTicketRecordParams) => mockPullTicketRecord(params) }));
// -------------------------
interface BuildTicketPlansParams {
	cwd: string;
	branch: string;
	record: WorkOrderState;
	env: NodeJS.ProcessEnv;
	driverName: string;
	workOrderRunDir: string;
	allowTicketBodyBuild: boolean;
}

const mockBuildTicketPlans = jest.fn<(params: BuildTicketPlansParams) => Promise<WorkerOutcome>>();

jest.mock('#src/queue/workers/buildWorkOrderPlans.ts', () => ({
	buildWorkOrderPlans: (params: BuildTicketPlansParams) => mockBuildTicketPlans(params),
}));
// -------------------------

const branch = 'lo-70-drain';
const planId = '002-search-basics';
const address = `${branch}/${planId}`;

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	url: 'https://linear.app/lightsout/issue/LO-70',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.ReadyAutoPlan,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
};

/** The record the choice answers with: plan 001 implemented, and plan 002 the one still being planned. */
const chosenRecord: WorkOrderState = {
	schemaVersion: 1,
	name: branch,
	ticketRef: 'LO-70',
	branch,
	mode: 'multiple-plan',
	plans: [
		{ id: '001-drain-basics', title: 'Drain basics', progress: 'implemented', createdAt: '2026-01-01T00:00:00.000Z' },
		{ id: planId, title: 'Search basics', progress: 'planning', createdAt: '2026-01-02T00:00:00.000Z' },
	],
	history: [{ at: '2026-01-02T00:00:00.000Z', kind: 'plan-added', detail: `added plan ${planId}` }],
};

/** The same record after the session published its plan, which is what the pull after the session answers. */
const plannedRecord: WorkOrderState = {
	...chosenRecord,
	plans: chosenRecord.plans.map((plan) => (plan.id === planId ? { ...plan, progress: 'ready' } : plan)),
};

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'planned it',
	failures: [],
	...overrides,
});

/**
 * The worker's arguments against a real worktree on disk, since the missing-folder
 * guard reads the tree rather than a stub.
 *
 * `choice` is the plan the engine picked before the session starts, `report` is
 * what the planning session hands back, `pulled` is the record read after it,
 * and `build` is what the ordered per-plan build loop hands back.
 */
const setupAutoPlanWorker = ({
	choice = { record: chosenRecord, address },
	report = reportOf(),
	pulled = { record: plannedRecord },
	build = {},
	planFolder = true,
}: {
	choice?: ChooseAutoPlanTargetResult;
	report?: WorkReport;
	pulled?: PullTicketRecordResult;
	build?: WorkerOutcome;
	planFolder?: boolean;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-auto-plan-'));
	const folder = join(cwd, '.lightsout', 'work-orders', branch, 'plans', planId);

	if (planFolder) {
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'plan.md'), '# The plan\n');
	}

	mockChooseAutoPlanTarget.mockResolvedValue(choice);
	mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report });
	mockPullTicketRecord.mockResolvedValue(pulled);
	mockBuildTicketPlans.mockResolvedValue(build);

	const progress: string[] = [];

	return {
		folder,
		progress,
		params: {
			cwd,
			ticket,
			branch,
			config,
			driver,
			driverName: 'claude-code',
			settings: queueSettingsFixture(),
			env: { LINEAR_API_KEY: 'key-1' },
			workOrderRunDir: join(cwd, '.lightsout', 'runs', 'run-q', 'work-orders', 'LO-70'),
			onProgress: (message: string) => progress.push(message),
		},
	};
};

/**
 * The queue's own shape: a primary checkout with the ticket's linked worktree
 * cut from it, the headless session planning inside that tree, and the plan
 * folder held only by the primary — which is where the finished-folder guard
 * has to look once a plan folder never leaves the main checkout.
 */
const setupHeadlessWorktreeSession = () => {
	const { cwd } = setupBranchRepo();
	// realpath on both sides, so macOS's symlinked temp directory cannot make the
	// folder written here and the one git answers with look like different places.
	const primary = realpathSync(cwd);
	const worktree = join(primary, '.worktrees', branch);

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	const folder = join(primary, '.lightsout', 'work-orders', branch, 'plans', planId);

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'plan.md'), '# The plan\n');

	mockChooseAutoPlanTarget.mockResolvedValue({ record: chosenRecord, address });
	mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report: reportOf() });
	mockPullTicketRecord.mockResolvedValue({ record: plannedRecord });
	mockBuildTicketPlans.mockResolvedValue({});

	return {
		params: {
			cwd: worktree,
			ticket,
			branch,
			config,
			driver,
			driverName: 'claude-code',
			settings: queueSettingsFixture(),
			env: { LINEAR_API_KEY: 'key-1' },
			workOrderRunDir: join(runDirFor({ cwd: worktree, runId: 'run-q', pipeline: 'queue' }), 'work-orders', 'LO-70'),
		},
	};
};

describe('runAutoPlanWorker', () => {
	test('the engine runs the build itself once the auto-plan session reports its plan complete', async () => {
		const { params } = setupAutoPlanWorker({ build: { error: 'tsc: 3 errors' } });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({ error: 'tsc: 3 errors' });
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(expect.objectContaining({ cwd: params.cwd, branch }));
	});

	test('announces on the progress stream that the engine is taking the build over', async () => {
		const { params, progress } = setupAutoPlanWorker();

		await runAutoPlanWorker(params);

		expect(progress).toContainEqual(expect.stringContaining('implement pipeline'));
	});

	test('starts no build for a turn the session ended by asking a question', async () => {
		const { params } = setupAutoPlanWorker({ report: reportOf({ status: WorkReportStatus.TerminatedAmbiguity, failures: ['Which one?'] }) });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({ question: 'Which one?' });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test("runAutoPlanWorker: hands the session the engine's plan address and builds through the ordered loop", async () => {
		const { params } = setupAutoPlanWorker();

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({});
		expect(mockInvokeAgentWithContract.mock.calls[0]?.[0].invocation.prompt).toContain(address);
		// the record is read again after the session, because publishing the plan
		// moved it from still being planned to ready to implement
		expect(mockPullTicketRecord.mock.invocationCallOrder[0]).toBeGreaterThan(mockInvokeAgentWithContract.mock.invocationCallOrder[0] ?? 0);
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(expect.objectContaining({ record: plannedRecord, allowTicketBodyBuild: false }));
	});

	test('runAutoPlanWorker: a ticket with nothing waiting to be planned starts no session and is left open', async () => {
		const loopReason = 'LO-70 is not authorized to ship: no ship request names its plans';
		const { params } = setupAutoPlanWorker({ choice: { record: chosenRecord }, build: { open: loopReason } });

		const outcome = await runAutoPlanWorker(params);

		expect(mockInvokeAgentWithContract).not.toHaveBeenCalled();
		expect(outcome).toEqual({ open: expect.stringContaining('no plan is waiting to be planned') });
		expect(outcome.open).toEqual(expect.stringContaining(loopReason));
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(expect.objectContaining({ record: chosenRecord, allowTicketBodyBuild: false }));
	});

	test('runAutoPlanWorker: parks when the session left no folder at the chosen address', async () => {
		const { params, folder } = setupAutoPlanWorker({ planFolder: false });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toEqual({ error: expect.stringContaining(folder) });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test("a headless planning session's plan folder is found in the primary checkout", async () => {
		const { params } = setupHeadlessWorktreeSession();

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({});
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(expect.objectContaining({ cwd: params.cwd, branch, record: plannedRecord }));
	});

	test('runAutoPlanWorker: a failed plan choice starts no session', async () => {
		const choiceError = `the ticket record published on LO-70 and the local one both moved — run lightsout work-order sync --name ${branch}`;
		const { params } = setupAutoPlanWorker({ choice: { error: choiceError } });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({ error: choiceError });
		expect(mockInvokeAgentWithContract).not.toHaveBeenCalled();
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});
});

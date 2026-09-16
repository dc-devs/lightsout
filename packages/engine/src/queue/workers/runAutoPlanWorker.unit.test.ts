// Dependencies
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runAutoPlanWorker } from '#src/queue/workers/runAutoPlanWorker.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The direct runtime's behavioral tests exercise real planning separately; this seam owns target selection and build ownership.
const mockRunPlanningSession = jest.fn<typeof import('#src/queue/workers/runPlanningSession.ts').runPlanningSession>();
jest.mock('#src/queue/workers/runPlanningSession.ts', () => ({
	runPlanningSession: (params: Parameters<typeof mockRunPlanningSession>[0]) => mockRunPlanningSession(params),
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

type ChooseAutoPlanTargetResult = { record: TicketRecord; address?: string } | { error: string };

const mockChooseAutoPlanTarget = jest.fn<(params: ChooseAutoPlanTargetParams) => Promise<ChooseAutoPlanTargetResult>>();

jest.mock('#src/queue/workers/chooseAutoPlanTarget.ts', () => ({
	chooseAutoPlanTarget: (params: ChooseAutoPlanTargetParams) => mockChooseAutoPlanTarget(params),
}));
// -------------------------
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
const chosenRecord: TicketRecord = {
	schemaVersion: 1,
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
const plannedRecord: TicketRecord = {
	...chosenRecord,
	plans: chosenRecord.plans.map((plan) => (plan.id === planId ? { ...plan, progress: 'ready' } : plan)),
};

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
	stopped,
	pulled = { record: plannedRecord },
	build = {},
	planFolder = true,
}: {
	choice?: ChooseAutoPlanTargetResult;
	stopped?: WorkerOutcome;
	pulled?: PullTicketRecordResult;
	build?: WorkerOutcome;
	planFolder?: boolean;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-auto-plan-'));
	const folder = join(cwd, '.lightsout', 'plans', branch, planId);

	if (planFolder) {
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'plan.md'), '# The plan\n');
	}

	mockChooseAutoPlanTarget.mockResolvedValue(choice);
	mockRunPlanningSession.mockResolvedValue(stopped);
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
			ticketRunDir: join(cwd, '.lightsout', 'runs', 'run-q', 'tickets', 'LO-70'),
			onProgress: (message: string) => progress.push(message),
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

	test('starts no build for a turn the session ended by asking a question', async () => {
		const { params } = setupAutoPlanWorker({ stopped: { question: 'Which one?' } });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({ question: 'Which one?' });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test("runAutoPlanWorker: hands the session the engine's plan address and builds through the ordered loop", async () => {
		const { params } = setupAutoPlanWorker();

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({});
		expect(mockRunPlanningSession).toHaveBeenCalledWith(expect.objectContaining({ planAddress: address, config: params.config }));
		// the record is read again after the session, because publishing the plan
		// moved it from still being planned to ready to implement
		expect(mockPullTicketRecord.mock.invocationCallOrder[0]).toBeGreaterThan(mockRunPlanningSession.mock.invocationCallOrder[0] ?? 0);
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(expect.objectContaining({ record: plannedRecord, allowTicketBodyBuild: false }));
	});

	test('runAutoPlanWorker: a ticket with nothing waiting to be planned starts no session and is left open', async () => {
		const loopReason = 'LO-70 is not authorized to ship: no ship request names its plans';
		const { params } = setupAutoPlanWorker({ choice: { record: chosenRecord }, build: { open: loopReason } });

		const outcome = await runAutoPlanWorker(params);

		expect(mockRunPlanningSession).not.toHaveBeenCalled();
		expect(outcome).toEqual({ open: expect.stringContaining('no plan is waiting to be planned') });
		expect(outcome.open).toEqual(expect.stringContaining(loopReason));
		expect(mockBuildTicketPlans).toHaveBeenCalledWith(expect.objectContaining({ record: chosenRecord, allowTicketBodyBuild: false }));
	});

	test('propagates a planner publication failure without starting implementation', async () => {
		const { params } = setupAutoPlanWorker({ stopped: { error: 'Upload refused' } });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toEqual({ error: 'Upload refused' });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('runAutoPlanWorker: a failed plan choice starts no session', async () => {
		const choiceError = `the ticket record published on LO-70 and the local one both moved — run lightsout ticket sync --name ${branch}`;
		const { params } = setupAutoPlanWorker({ choice: { error: choiceError } });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({ error: choiceError });
		expect(mockRunPlanningSession).not.toHaveBeenCalled();
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});
});

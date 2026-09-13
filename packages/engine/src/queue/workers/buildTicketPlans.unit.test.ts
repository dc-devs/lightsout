import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { buildTicketPlans } from '#src/queue/workers/buildTicketPlans.ts';
import { planFile, planOf, setupTicketPlanBuild } from '#tests/helpers/setupTicketPlanBuild.ts';

// Mocked Imports
// -------------------------
// Both implement pipelines spawn a harness against a real repository, and each
// is covered by its own tests. Stubbing the pair leaves the ticket lifecycle and
// the record on disk real, so the order the plans build in — and the progress a
// build leaves behind — are read from the same record every later plan reads.
const mockRunPhasesPipeline = jest.fn<(params: { overviewPath: string }) => Promise<PipelineResult>>();

jest.mock('#src/phases/index.ts', () => ({
	runPhasesPipeline: (params: { overviewPath: string }) => mockRunPhasesPipeline(params),
}));
// -------------------------
const mockRunImplementPipeline = jest.fn<(params: { planPath: string }) => Promise<PipelineResult>>();

jest.mock('#src/pipeline/index.ts', () => ({
	runImplementPipeline: (params: { planPath: string }) => mockRunImplementPipeline(params),
}));
// -------------------------
const mockRunDirectWork = jest.fn<(params: DirectCall) => Promise<PipelineResult>>();

jest.mock('#src/direct/index.ts', () => ({
	runDirectWork: (params: DirectCall) => mockRunDirectWork(params),
}));
// -------------------------
// The commit is stubbed rather than run: a refused commit is one of the cases
// stated here, and git refuses on its own terms rather than on demand.
const mockCommitTicketWork = jest.fn<(params: { cwd: string; message: string; runDir: string }) => Promise<{ committed: boolean } | QueueFailure>>();

jest.mock('#src/queue/commitTicketWork.ts', () => ({
	commitTicketWork: (params: { cwd: string; message: string; runDir: string }) => mockCommitTicketWork(params),
}));
// -------------------------
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({
	readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params),
}));
// -------------------------
// Only the tracker half of the ticket module is stubbed: a restore is the one
// call that would leave the machine. The record store, the implementation-order
// rules and the ship-eligibility rule stay real and read the record on disk.
const mockRestoreTicketPlan = jest.fn<(params: { cwd: string; address: string }) => Promise<{ restored: string[] } | { error: string }>>();

jest.mock('#src/ticket/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticket/index.ts')>('#src/ticket/index.ts'),
	restoreTicketPlan: (params: { cwd: string; address: string }) => mockRestoreTicketPlan(params),
}));
// -------------------------

/** What a build of the ticket body was handed, restated here because a `jest.mock` factory may not reach outside the file. */
interface DirectCall {
	cwd: string;
	ticketBody: string;
	ticketRef: string;
	runId?: string;
	driverName: string;
	config: LightsoutConfig;
}

/** The stubs the shared fixture arranges, gathered once. */
const mocks = {
	runImplementPipeline: mockRunImplementPipeline,
	runPhasesPipeline: mockRunPhasesPipeline,
	runDirectWork: mockRunDirectWork,
	commitTicketWork: mockCommitTicketWork,
	readGitChangedFiles: mockReadGitChangedFiles,
	restoreTicketPlan: mockRestoreTicketPlan,
};

/** The plan entries the cases below are built from — 001 already built, and the two that follow it. */
const firstReady = planOf({ id: '001-search-index', title: 'Search index', progress: PlanProgress.Ready });
const firstImplemented = planOf({
	id: '001-search-index',
	title: 'Search index',
	progress: PlanProgress.Implemented,
	runId: 'run-1',
	finishedAt: '2026-01-03T00:00:00.000Z',
});
const secondReady = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Ready });
const thirdReady = planOf({ id: '003-search-ranking', title: 'Search ranking', progress: PlanProgress.Ready });

describe('buildTicketPlans', () => {
	test('buildTicketPlans: builds the ready plans in numeric order and commits each before the next starts', async () => {
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady, thirdReady] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(calls).toStrictEqual([
			`build ${planFile({ cwd, planId: '002-search-basics' })}`,
			'commit LO-7 002-search-basics: Search basics',
			`build ${planFile({ cwd, planId: '003-search-ranking' })}`,
			'commit LO-7 003-search-ranking: Search ranking',
		]);
		expect(outcome.error).toBeUndefined();
	});

	test("buildTicketPlans: commits each plan with the ticket identifier, the plan id and the plan's title", async () => {
		const { cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		// a plan's implementation can only be removed by its own commit if the
		// commit says which plan it belongs to
		expect(mockCommitTicketWork).toHaveBeenCalledWith(
			expect.objectContaining({ cwd, message: 'LO-7 002-search-basics: Search basics', runDir: params.ticketRunDir }),
		);
		expect(outcome.error).toBeUndefined();
	});

	test('buildTicketPlans: restores a ready plan only when its folder is absent', async () => {
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady, thirdReady], missingFolders: ['002-search-basics'] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(mockRestoreTicketPlan).toHaveBeenCalledTimes(1);
		expect(mockRestoreTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ cwd, address: 'lo-7-search/002-search-basics' }));
		expect(calls.slice(0, 2)).toStrictEqual(['restore lo-7-search/002-search-basics', `build ${planFile({ cwd, planId: '002-search-basics' })}`]);
		expect(outcome.error).toBeUndefined();
	});

	test('buildTicketPlans: a ready plan the ticket carries no files for stops with an error', async () => {
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady], missingFolders: ['002-search-basics'], restoreWrites: false });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test('buildTicketPlans: a lower plan still being planned leaves the ticket open without building later plans', async () => {
		const secondPlanning = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Planning });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondPlanning, thirdReady] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		// nothing has gone wrong — the ticket is waiting on a plan somebody is
		// still writing, so it is left open rather than parked
		expect(outcome).toEqual({ open: expect.stringContaining('002-search-basics') });
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test('buildTicketPlans: a failed lower plan parks the ticket naming the plan and its repair commands', async () => {
		const secondFailed = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Failed, runId: 'run-9' });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondFailed, thirdReady] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.open).toBeUndefined();
		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-9'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout ticket exclude-plan'));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
	});

	test('buildTicketPlans: a plan whose implementation has not finished parks the ticket', async () => {
		const secondImplementing = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Implementing, runId: 'run-4' });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondImplementing, thirdReady] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.open).toBeUndefined();
		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-4'));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
	});

	test('buildTicketPlans: an excluded plan never holds later plans back', async () => {
		const secondExcluded = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Planning, excluded: true });
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondExcluded, thirdReady] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(calls).toStrictEqual([`build ${planFile({ cwd, planId: '003-search-ranking' })}`, 'commit LO-7 003-search-ranking: Search ranking']);
		expect(outcome.error).toBeUndefined();
	});

	test('buildTicketPlans: commits leftover work under the latest implemented plan before taking the next plan', async () => {
		const { calls, cwd, params } = setupTicketPlanBuild({
			mocks,
			plans: [firstImplemented, secondReady],
			leftover: ['packages/engine/src/search/readIndex.ts'],
		});

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		// the leftovers can only have come from plan 001's own build or repair, so
		// they go under its message before 002 puts anything in the tree
		expect(calls).toStrictEqual([
			'commit LO-7 001-search-index: Search index',
			`build ${planFile({ cwd, planId: '002-search-basics' })}`,
			'commit LO-7 002-search-basics: Search basics',
		]);
		expect(outcome.error).toBeUndefined();
	});

	test('buildTicketPlans: parks on leftover work that no implemented plan owns', async () => {
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstReady, secondReady], leftover: ['packages/engine/src/search/readIndex.ts'] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toEqual(expect.stringContaining(cwd));
		expect(calls).toStrictEqual([]);
	});

	test('buildTicketPlans: stops at a failed next plan before settling leftover work so its partial changes stay for resume', async () => {
		const secondFailed = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Failed, runId: 'run-9' });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondFailed], leftover: ['packages/engine/src/search/readIndex.ts'] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		// the leftovers are 002's half-built work, so committing them under 001's
		// message would take them out of the tree the resume expects them in
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-9'));
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});
});

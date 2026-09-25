import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { buildWorkOrderPlans } from '#src/queue/workers/buildWorkOrderPlans.ts';
import { planAt, planFile, planOf, setupTicketPlanBuild } from '#tests/helpers/setupTicketPlanBuild.ts';

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
const mockCommitTicketWork =
	jest.fn<
		(params: {
			cwd: string;
			composeMessage: ({ cwd }: { cwd: string }) => Promise<string>;
			runDir: string;
		}) => Promise<{ committed: false } | { committed: true; message: string } | QueueFailure>
	>();

jest.mock('#src/commit/commitWorkOrderWork.ts', () => ({
	commitWorkOrderWork: (params: { cwd: string; composeMessage: ({ cwd }: { cwd: string }) => Promise<string>; runDir: string }) => mockCommitTicketWork(params),
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

jest.mock('#src/workOrder/index.ts', () => ({
	...jest.requireActual<typeof import('#src/workOrder/index.ts')>('#src/workOrder/index.ts'),
	restoreWorkOrderPlan: (params: { cwd: string; address: string }) => mockRestoreTicketPlan(params),
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
	commitWorkOrderWork: mockCommitTicketWork,
	readGitChangedFiles: mockReadGitChangedFiles,
	restoreWorkOrderPlan: mockRestoreTicketPlan,
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

/**
 * The shared fixture's work order, rewritten so its branch carries a prefix its
 * label does not: the record names `feature/lo-7-search` as the branch its plans
 * implement on, while the folder it sits in — its label — stays `lo-7-search`.
 *
 * The rewrite lands on disk as well as on the value handed to the loop, so the
 * record the loop re-reads between plans carries the prefix too, and every plan
 * address it composes is composed against it.
 */
const setupPrefixedBranchBuild = () => {
	const { calls, cwd, params } = setupTicketPlanBuild({
		mocks,
		plans: [firstImplemented, secondReady, thirdReady],
		missingFolders: ['002-search-basics'],
	});
	const record = { ...params.record, branch: 'feature/lo-7-search' };

	writeFileSync(join(cwd, '.lightsout', 'work-orders', 'lo-7-search', 'state.json'), JSON.stringify(record));

	return { calls, cwd, params: { ...params, record } };
};

/**
 * The same prefixed-branch work order, with its one plan left to build passing
 * over a single phase file rather than over the whole plan.
 *
 * A pass that narrow leaves the plan's implementation unfinished, so the loop
 * refuses — which is what puts a refusal sentence in reach of the case below.
 */
const setupPrefixedBranchRefusal = () => {
	const { calls, cwd, params } = setupTicketPlanBuild({
		mocks,
		plans: [firstImplemented, secondReady],
		missingFolders: ['002-search-basics'],
		build: 'one-phase',
	});
	const record = { ...params.record, branch: 'feature/lo-7-search' };

	writeFileSync(join(cwd, '.lightsout', 'work-orders', 'lo-7-search', 'state.json'), JSON.stringify(record));

	return { calls, cwd, params: { ...params, record } };
};

describe('buildWorkOrderPlans', () => {
	test('confirms each plan without committing it a second time', async () => {
		// The numeric build order this pins was once asserted alongside a commit
		// the loop made between plans; that commit is the build pipeline's now, so
		// the order and the absence of a second commit are one case.
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady, thirdReady] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		// each plan's own build pipeline commits the work it made, so the loop
		// only re-reads the record to see the implementation recorded as finished
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(calls).toStrictEqual([`build ${planFile({ cwd, planId: '002-search-basics' })}`, `build ${planFile({ cwd, planId: '003-search-ranking' })}`]);
		expect([planAt({ cwd, id: '002-search-basics' })?.progress, planAt({ cwd, id: '003-search-ranking' })?.progress]).toStrictEqual([
			'implemented',
			'implemented',
		]);
		expect(outcome.error).toBeUndefined();
	});

	test('buildWorkOrderPlans: restores a ready plan only when its folder is absent', async () => {
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady, thirdReady], missingFolders: ['002-search-basics'] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		expect(mockRestoreTicketPlan).toHaveBeenCalledTimes(1);
		expect(mockRestoreTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ cwd, address: 'lo-7-search/002-search-basics' }));
		expect(calls.slice(0, 2)).toStrictEqual(['restore lo-7-search/002-search-basics', `build ${planFile({ cwd, planId: '002-search-basics' })}`]);
		expect(outcome.error).toBeUndefined();
	});

	test('buildWorkOrderPlans: a ready plan the ticket carries no files for stops with an error', async () => {
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady], missingFolders: ['002-search-basics'], restoreWrites: false });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test('buildWorkOrderPlans: a lower plan still being planned leaves the ticket open without building later plans', async () => {
		const secondPlanning = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Planning });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondPlanning, thirdReady] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		// nothing has gone wrong — the ticket is waiting on a plan somebody is
		// still writing, so it is left open rather than parked
		expect(outcome).toEqual({ open: expect.stringContaining('002-search-basics') });
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test('buildWorkOrderPlans: a failed lower plan parks the ticket naming the plan and its repair commands', async () => {
		const secondFailed = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Failed, runId: 'run-9' });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondFailed, thirdReady] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.open).toBeUndefined();
		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-9'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout work-order exclude-plan'));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
	});

	test('buildWorkOrderPlans: a plan whose implementation has not finished parks the ticket', async () => {
		const secondImplementing = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Implementing, runId: 'run-4' });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondImplementing, thirdReady] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.open).toBeUndefined();
		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-4'));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
	});

	test('buildWorkOrderPlans: the stalled-plan park sentence spells the work-order command word', async () => {
		const secondImplementing = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Implementing, runId: 'run-4' });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondImplementing, thirdReady] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		// the sentence offers both repair paths, and the second of them is the
		// subcommand whose command word this phase renames
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-4'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout work-order exclude-plan --name lo-7-search --plan 002-search-basics'));
		expect(outcome.error).not.toEqual(expect.stringContaining('lightsout ticket '));
	});

	test('buildWorkOrderPlans: an excluded plan never holds later plans back', async () => {
		const secondExcluded = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Planning, excluded: true });
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondExcluded, thirdReady] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		expect(calls).toStrictEqual([`build ${planFile({ cwd, planId: '003-search-ranking' })}`]);
		expect(outcome.error).toBeUndefined();
	});

	test('buildWorkOrderPlans: commits leftover work under the latest implemented plan before taking the next plan', async () => {
		const { calls, cwd, params } = setupTicketPlanBuild({
			mocks,
			plans: [firstImplemented, secondReady],
			leftover: ['packages/engine/src/search/readIndex.ts'],
		});

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		// the leftovers can only have come from plan 001's own build or repair, so
		// they go under its message before 002 puts anything in the tree
		expect(calls).toStrictEqual(['commit LO-7 001-search-index: Search index', `build ${planFile({ cwd, planId: '002-search-basics' })}`]);
		expect(outcome.error).toBeUndefined();
	});

	test('buildWorkOrderPlans: parks on leftover work that no implemented plan owns', async () => {
		const { calls, cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstReady, secondReady], leftover: ['packages/engine/src/search/readIndex.ts'] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toEqual(expect.stringContaining(cwd));
		expect(calls).toStrictEqual([]);
	});

	test('builds a plan address from the label rather than the prefixed branch', async () => {
		const { calls, cwd, params } = setupPrefixedBranchBuild();

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		// composed from the branch instead, each address would carry three segments
		// — `feature/lo-7-search/002-search-basics` — which is not an address at all,
		// so neither the fetch nor the build would find the plan
		expect(mockRestoreTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ cwd, address: 'lo-7-search/002-search-basics' }));
		expect(calls).toStrictEqual([
			'restore lo-7-search/002-search-basics',
			`build ${planFile({ cwd, planId: '002-search-basics' })}`,
			`build ${planFile({ cwd, planId: '003-search-ranking' })}`,
		]);
		expect([planAt({ cwd, id: '002-search-basics' })?.progress, planAt({ cwd, id: '003-search-ranking' })?.progress]).toStrictEqual([
			'implemented',
			'implemented',
		]);
		expect(outcome.error).toBeUndefined();
	});

	test('buildWorkOrderPlans: stops at a failed next plan before settling leftover work so its partial changes stay for resume', async () => {
		const secondFailed = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Failed, runId: 'run-9' });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondFailed], leftover: ['packages/engine/src/search/readIndex.ts'] });

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		// the leftovers are 002's half-built work, so committing them under 001's
		// message would take them out of the tree the resume expects them in
		expect(outcome.error).toEqual(expect.stringContaining('lightsout resume --run run-9'));
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test("addresses every plan by the work order's label", async () => {
		const { calls, cwd, params } = setupPrefixedBranchRefusal();

		const outcome = await buildWorkOrderPlans({ ...params, allowTicketBodyBuild: false });

		// the fetch and the build are both asked for a two-segment address built
		// from the label, and the refusal names the work order the same way — the
		// prefixed branch the record stores reaches none of the three
		expect(calls).toStrictEqual(['restore lo-7-search/002-search-basics', `build ${planFile({ cwd, planId: '002-search-basics' })}`]);
		expect(mockRestoreTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ cwd, address: 'lo-7-search/002-search-basics' }));
		expect(outcome.error).toEqual(expect.stringContaining('lo-7-search'));
		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(outcome.error).not.toEqual(expect.stringContaining('feature/'));
	});
});

import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, TicketMode } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { buildTicketPlans } from '#src/queue/workers/buildTicketPlans.ts';
import { config, planAt, planOf, setupTicketPlanBuild } from '#tests/helpers/setupTicketPlanBuild.ts';

/**
 * What each build of a ticket's plans amounts to: a build that failed, a plan
 * whose published files moved, the one build with no plan deliverable behind it,
 * and the answer the loop gives once nothing is left to build.
 *
 * A sibling of `buildTicketPlans.unit.test.ts` rather than more cases in it:
 * that file states which plan the loop takes and in what order, while every
 * case here is about what comes back from taking one.
 */

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

/** The plan entries the cases below are built from — 001 in each of the states a case needs, and the two that follow it. */
const firstPlanned = planOf({ id: '001-search-index', title: 'Search index', progress: PlanProgress.Planning });
const firstImplemented = planOf({
	id: '001-search-index',
	title: 'Search index',
	progress: PlanProgress.Implemented,
	runId: 'run-1',
	finishedAt: '2026-01-03T00:00:00.000Z',
});
const secondReady = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Ready });
const secondImplemented = planOf({
	id: '002-search-basics',
	title: 'Search basics',
	progress: PlanProgress.Implemented,
	runId: 'run-2',
	finishedAt: '2026-01-04T00:00:00.000Z',
});
const thirdReady = planOf({ id: '003-search-ranking', title: 'Search ranking', progress: PlanProgress.Ready });

describe('buildTicketPlans', () => {
	test('buildTicketPlans: parks rather than build a plan whose published files moved on another machine', async () => {
		const secondRepublished = planOf({ id: '002-search-basics', title: 'Search basics', progress: PlanProgress.Ready, publishedMarker: 'b'.repeat(64) });
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondRepublished] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(outcome.error).toEqual(expect.stringContaining('lightsout ticket sync'));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test('buildTicketPlans: a failed build stops the loop without committing', async () => {
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady, thirdReady], build: 'fails' });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toEqual(expect.stringContaining('the gates stayed red'));
		expect(mockRunImplementPipeline).toHaveBeenCalledTimes(1);
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
	});

	test('buildTicketPlans: a refused commit stops the loop before the next plan', async () => {
		const refused = { error: 'git could not commit the work: the pre-commit hook refused it' };
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady, thirdReady], commitResult: refused });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toEqual(expect.stringContaining('the pre-commit hook refused it'));
		expect(mockRunImplementPipeline).toHaveBeenCalledTimes(1);
	});

	test('buildTicketPlans: a passed build its record does not show implemented stops instead of repeating', async () => {
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondReady, thirdReady], build: 'one-phase' });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		// a pass over one phase file leaves the plan's implementation unfinished,
		// so taking the same plan again would loop on it forever
		expect(outcome.error).toEqual(expect.stringContaining('002-search-basics'));
		expect(mockRunImplementPipeline).toHaveBeenCalledTimes(1);
	});

	test('buildTicketPlans: an eligible ticket answers success so it goes on to ship', async () => {
		const request = { planIds: ['001-search-index', '002-search-basics'], requestedAt: '2026-01-05T00:00:00.000Z' };
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondImplemented], shipRequest: request });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome).toStrictEqual({});
	});

	test('buildTicketPlans: an implemented multiple-plan ticket with no ship request is left open', async () => {
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstImplemented, secondImplemented] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.error).toBeUndefined();
		expect(outcome.open).toEqual(expect.stringContaining('ship request'));
	});

	test('buildTicketPlans: a single-plan plan 001 still being planned is built from the ticket body through the lifecycle helper', async () => {
		const { cwd, params } = setupTicketPlanBuild({ mocks, plans: [firstPlanned], mode: TicketMode.SinglePlan });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: true });

		expect(mockRunDirectWork).toHaveBeenCalledWith(
			expect.objectContaining({ cwd, ticketBody: 'Build search.', ticketRef: 'LO-7', driverName: 'claude-code', config }),
		);
		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ message: 'LO-7 001-search-index: Search index' }));
		// the recorded progress is what the ship guard reads afterwards, and only
		// the lifecycle helper writes it
		expect(planAt({ cwd, id: '001-search-index' })?.progress).toBe('implemented');
		expect(outcome).toStrictEqual({});
	});

	test('buildTicketPlans: without the body fallback a single-plan plan still being planned parks', async () => {
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstPlanned], mode: TicketMode.SinglePlan });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: false });

		expect(outcome.open).toBeUndefined();
		expect(outcome.error).toEqual(expect.stringContaining('001-search-index'));
		expect(mockRunDirectWork).not.toHaveBeenCalled();
	});

	test('buildTicketPlans: a multiple-plan ticket is never built from the ticket body', async () => {
		const { params } = setupTicketPlanBuild({ mocks, plans: [firstPlanned] });

		const outcome = await buildTicketPlans({ ...params, allowTicketBodyBuild: true });

		// a later plan has no ticket body of its own, so the fallback belongs to
		// single-plan plan 001 alone
		expect(outcome).toEqual({ open: expect.stringContaining('001-search-index') });
		expect(mockRunDirectWork).not.toHaveBeenCalled();
	});
});

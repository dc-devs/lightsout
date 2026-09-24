import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { jest } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import {
	type LightsoutConfig,
	PipelineKind,
	type PlanProgress,
	type RunManifest,
	RunStatus,
	WorkOrderEventKind,
	WorkOrderMode,
	type WorkOrderPlan,
	type WorkOrderState,
} from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** What a build of the ticket body was handed — the fields a case reads back off it. */
interface DirectCall {
	cwd: string;
	ticketBody: string;
	ticketRef: string;
	runId?: string;
	driverName: string;
	config: LightsoutConfig;
}

type CommitResult = { committed: false } | { committed: true; message: string } | QueueFailure;

/**
 * The stubs a `buildWorkOrderPlans` test file declares in its own `jest.mock`
 * blocks and hands here, so this fixture can arrange what each one answers.
 *
 * They are the calls that would spawn a harness, run git or leave the machine;
 * the record store and the ticket rules stay real and read the record on disk.
 */
export interface TicketPlanBuildMocks {
	runImplementPipeline: jest.Mock<(params: { planPath: string }) => Promise<PipelineResult>>;
	runPhasesPipeline: jest.Mock<(params: { overviewPath: string }) => Promise<PipelineResult>>;
	runDirectWork: jest.Mock<(params: DirectCall) => Promise<PipelineResult>>;
	commitWorkOrderWork: jest.Mock<
		(params: { cwd: string; composeMessage: ({ cwd }: { cwd: string }) => Promise<string>; runDir: string }) => Promise<CommitResult>
	>;
	readGitChangedFiles: jest.Mock<(params: { cwd: string }) => Promise<string[] | undefined>>;
	restoreWorkOrderPlan: jest.Mock<(params: { cwd: string; address: string }) => Promise<{ restored: string[] } | { error: string }>>;
}

export const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
export const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

/** The ticket folder's name, which is also the branch every plan below implements on. */
export const workOrderName = 'lo-7-search';

export const ticket: TicketSummary = {
	id: 'id-7',
	identifier: 'LO-7',
	title: 'Search the plans',
	url: 'https://linear.app/lightsout/issue/LO-7',
	description: 'Build search.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
};

export const planOf = ({
	id,
	title,
	progress,
	runId,
	finishedAt,
	excluded = false,
	publishedMarker,
}: {
	id: string;
	title: string;
	progress: PlanProgress;
	runId?: string;
	finishedAt?: string;
	excluded?: boolean;
	publishedMarker?: string;
}): WorkOrderPlan => ({
	id,
	title,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(runId === undefined
		? {}
		: { implementation: { runId, startedAt: '2026-01-02T00:00:00.000Z', startCommit: 'a1b2c3', ...(finishedAt === undefined ? {} : { finishedAt }) } }),
	...(publishedMarker === undefined ? {} : { publishedMarker }),
	...(excluded ? { exclusion: { at: '2026-01-02T00:00:00.000Z', reason: 'superseded by a later plan', implementationRemoved: false } } : {}),
});

const manifestOf = ({ status, plan, pipeline }: { status: RunStatus; plan: string; pipeline?: PipelineKind }): RunManifest => ({
	runId: 'run-built',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:01.000Z',
	plan,
	...(pipeline === undefined ? {} : { pipeline }),
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

/** What a stubbed build reports: a pass over the whole plan, a pass over one phase file of it, or a failure. */
export type BuildKind = 'passes' | 'one-phase' | 'fails';

const buildOutcome = ({ planPath, build }: { planPath: string; build: BuildKind }): PipelineResult =>
	build === 'fails'
		? { ok: false, error: 'the gates stayed red', manifest: manifestOf({ status: RunStatus.Failed, plan: planPath }) }
		: { ok: true, manifest: manifestOf({ status: RunStatus.Passed, plan: build === 'one-phase' ? join(dirname(planPath), 'phase1-search.md') : planPath }) };

/** Where one plan's `plan.md` sits in the worktree — the path a build of that plan is pointed at. */
export const planFile = ({ cwd, planId }: { cwd: string; planId: string }): string =>
	join(cwd, '.lightsout', 'work-orders', workOrderName, 'plans', planId, 'plan.md');

/** One plan's entry in the ticket's record as it stands on disk once the call has returned. */
export const planAt = ({ cwd, id }: { cwd: string; id: string }): WorkOrderPlan | undefined =>
	(JSON.parse(readFileSync(join(cwd, '.lightsout', 'work-orders', workOrderName, 'state.json'), 'utf8')) as WorkOrderState).plans.find(
		(plan) => plan.id === id,
	);

/**
 * A real repository standing on the ticket branch, holding the ticket's record
 * and one folder per plan.
 *
 * The record is written to disk as well as handed in, because the lifecycle each
 * build goes through reads and rewrites it there: what a passed build left is
 * then exactly what the loop's own re-read sees.
 *
 * `calls` is the one ordered log of everything the loop did — every restore,
 * every build and every commit — which is what the ordering cases assert on.
 */
export const setupTicketPlanBuild = ({
	mocks,
	plans,
	mode = WorkOrderMode.MultiplePlan,
	shipRequest,
	leftover = [],
	missingFolders = [],
	restoreWrites = true,
	build = 'passes',
	commitResult,
}: {
	mocks: TicketPlanBuildMocks;
	plans: WorkOrderPlan[];
	mode?: WorkOrderMode;
	shipRequest?: { planIds: string[]; requestedAt: string };
	leftover?: string[];
	missingFolders?: string[];
	restoreWrites?: boolean;
	build?: BuildKind;
	commitResult?: CommitResult;
}) => {
	const { cwd } = setupBranchRepo({ branch: workOrderName });
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', workOrderName);
	const record: WorkOrderState = {
		schemaVersion: 1,
		name: workOrderName,
		ticketRef: 'LO-7',
		branch: workOrderName,
		mode,
		plans,
		...(shipRequest === undefined ? {} : { shipRequest }),
		history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added the first plan' }],
	};
	const calls: string[] = [];

	mkdirSync(workOrderFolder, { recursive: true });

	for (const plan of plans.filter((candidate) => !missingFolders.includes(candidate.id))) {
		mkdirSync(join(workOrderFolder, 'plans', plan.id), { recursive: true });
		writeFileSync(join(workOrderFolder, 'plans', plan.id, 'plan.md'), `# ${plan.id}\n`);
	}

	writeFileSync(join(workOrderFolder, 'state.json'), JSON.stringify(record));

	mocks.runImplementPipeline.mockImplementation(({ planPath }) => {
		calls.push(`build ${planPath}`);

		return Promise.resolve(buildOutcome({ planPath, build }));
	});
	mocks.runPhasesPipeline.mockImplementation(({ overviewPath }) => {
		calls.push(`build ${overviewPath}`);

		return Promise.resolve(buildOutcome({ planPath: overviewPath, build }));
	});
	mocks.runDirectWork.mockImplementation(({ runId }) => {
		calls.push('direct build');

		return Promise.resolve({
			ok: true,
			manifest: {
				...manifestOf({
					status: RunStatus.Passed,
					plan: join(runDirFor({ cwd, runId: 'run-direct', workOrderName }), 'ticket.md'),
					pipeline: PipelineKind.Direct,
				}),
				runId: runId ?? 'run-direct',
			},
		});
	});
	mocks.commitWorkOrderWork.mockImplementation(async ({ cwd: worktree, composeMessage }) => {
		// Asked for as the real primitive asks once the change is staged. The
		// fixture's harness answers nothing the commit-message contract accepts,
		// so the message is the template subject — and the subject alone is
		// pushed: the body carries the run id, which is asserted where the message
		// is built rather than in this loop's ordering cases.
		const message = await composeMessage({ cwd: worktree });

		calls.push(`commit ${message.split('\n')[0]}`);

		return commitResult ?? { committed: true, message };
	});
	// The worktree is clean again once the leftovers have been settled, exactly
	// as a real read of it would report.
	mocks.readGitChangedFiles.mockResolvedValueOnce(leftover).mockResolvedValue([]);
	mocks.restoreWorkOrderPlan.mockImplementation(({ cwd: target, address }) => {
		calls.push(`restore ${address}`);

		if (!restoreWrites) {
			return Promise.resolve({ restored: [] });
		}

		mkdirSync(planWorkspaceFolder({ cwd: target, name: address }), { recursive: true });
		writeFileSync(join(planWorkspaceFolder({ cwd: target, name: address }), 'plan.md'), '# restored\n');

		return Promise.resolve({ restored: ['plan.md'] });
	});

	return {
		calls,
		cwd,
		params: {
			cwd,
			workOrderName,
			ticket,
			record,
			config,
			env: {} as NodeJS.ProcessEnv,
			driver,
			driverName: 'claude-code',
			workOrderRunDir: join(runDirFor({ cwd, runId: 'queue-run', pipeline: 'queue' }), 'work-orders', 'LO-7'),
		},
	};
};

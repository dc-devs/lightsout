import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf, runId, setupResume } from '#tests/helpers/setupResume.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// What this file pins is what resume does with a ticket's own record: which
// plan it decides the run belongs to, what it refuses, and what the record says
// afterwards. The record itself is written for real, because the record is the
// observable result. The two pipelines are doubled because each spawns a
// harness, and each is tested where it lives.
type PipelineParams = { cwd: string; existing?: RunManifest; runId?: string };
type DirectWorkParams = { cwd: string; ticketBody: string; ticketRef: string; existing?: RunManifest; runId?: string };
type GuardParams = { cwd: string; config: LightsoutConfig; env: NodeJS.ProcessEnv; ticketRef?: string; onProgress?: (message: string) => void };
type ExitAfterImplementParams = {
	config: LightsoutConfig;
	cwd: string;
	result: PipelineResult;
	shipFlag: boolean;
	noShipFlag: boolean;
	env: NodeJS.ProcessEnv;
};

const mockRunPipelineOrFailFast = jest.fn<(params: PipelineParams) => Promise<PipelineResult>>();

jest.mock('#src/cli/common/utils/runPipelineOrFailFast.ts', () => ({
	runPipelineOrFailFast: (params: PipelineParams) => mockRunPipelineOrFailFast(params),
}));
// -------------------------
const mockRunDirectWork = jest.fn<(params: DirectWorkParams) => Promise<PipelineResult>>();

jest.mock('#src/direct/runDirectWork.ts', () => ({ runDirectWork: (params: DirectWorkParams) => mockRunDirectWork(params) }));
// -------------------------
const mockRequireImplementLifecycle = jest.fn<(params: GuardParams) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/requireImplementLifecycle.ts', () => ({
	requireImplementLifecycle: (params: GuardParams) => mockRequireImplementLifecycle(params),
}));
// -------------------------
const mockExitAfterImplement = jest.fn<(params: ExitAfterImplementParams) => Promise<void>>();

jest.mock('#src/cli/common/utils/exitAfterImplement.ts', () => ({
	exitAfterImplement: (params: ExitAfterImplementParams) => mockExitAfterImplement(params),
}));
// -------------------------

/** The ticket's branch, which is also its folder's name under the plans directory. */
const workOrderName = 'lo-140-multi';

/** The two plan ids these cases address, and the addresses they are named by. */
const planOne = '001-ticket-record';
const planTwo = '002-plan-addressing';

/** A marker some other machine published: 64 lowercase hex characters, as the record spells one. */
const otherMachineMarker = 'a3'.repeat(32);

/** Where one plan's deliverable sits, relative to the checkout the run builds in. */
const planPath = ({ planId }: { planId: string }) => join('.lightsout', 'work-orders', workOrderName, 'plans', planId, 'plan.md');

/** The ticket body a direct run froze beside itself — the plan path a build from the ticket body records. */
const frozenTicketPath = join('.lightsout', 'runs', runId, 'ticket.md');

/** One plan of the record, carrying only the facts these cases turn on. */
const planWith = ({
	id,
	progress,
	implementation,
	excludedFor,
	publishedMarker,
}: {
	id: string;
	progress: PlanProgress;
	/** The run already recorded against this plan, and where its implementation began. */
	implementation?: { runId: string; startedAt: string; startCommit: string };
	/** The recorded reason, whose presence is what takes the plan out of the order. */
	excludedFor?: string;
	/** The marker the plan was last published under, which a sidecar this machine does not hold makes divergent. */
	publishedMarker?: string;
}): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-03-01T00:00:00.000Z',
	...(implementation === undefined ? {} : { implementation }),
	...(excludedFor === undefined ? {} : { exclusion: { at: '2026-03-05T09:00:00.000Z', reason: excludedFor, implementationRemoved: false } }),
	...(publishedMarker === undefined ? {} : { publishedMarker }),
});

/** The ticket's record as it stands on disk in the checkout the run builds in. */
const readRecord = ({ workspace }: { workspace: string }): WorkOrderState =>
	JSON.parse(readFileSync(join(workspace, '.lightsout', 'work-orders', workOrderName, 'state.json'), 'utf8'));

/**
 * A linked worktree of the ticket's checkout — the workspace an isolated run
 * parks in. It holds no plans directory and no ticket record of its own: both
 * stay in the checkout the tree was cut from.
 */
const cutRunWorktree = ({ primary }: { primary: string }) => {
	const worktree = join(mkdtempSync(join(tmpdir(), 'lightsout-resume-tree-')), 'tree');

	execSync(`git worktree add -q --detach "${worktree}"`, { cwd: primary, stdio: 'ignore' });

	return worktree;
};

/** The seeded run's manifest as it stands on disk in the checkout the command was launched from. */
const readManifest = ({ cwd }: { cwd: string }): { willShip?: boolean } => JSON.parse(readFileSync(join(runDirFor({ cwd, runId }), 'manifest.json'), 'utf8'));

/** The manifest a parked run left behind, which is what resuming reads. */
interface ParkedRun {
	/** What the manifest records as the run's plan: a plan's own deliverable, or the ticket body a direct run froze. */
	plan: string;
	status: RunStatus;
	/** The ship stamp the parked manifest already carries. */
	willShip?: boolean;
	pipeline?: PipelineKind;
}

/**
 * A parked run of one of a ticket's plans: the run's records in the checkout
 * the command was launched from, and the ticket branch's own checkout holding
 * the ticket record beside a folder per plan.
 *
 * That checkout is the workspace the run recorded, unless `isolated` puts the
 * run in a linked worktree cut from it — the shape every plan folder and every
 * ticket record is reached from its primary checkout in.
 *
 * Run state is gitignored there so the record and the run's files never read as
 * work a resumed direct build has to commit.
 */
const setupTicketResume = ({
	mode = WorkOrderMode.MultiplePlan,
	plans,
	parked,
	isolated = false,
}: {
	mode?: WorkOrderMode;
	plans: WorkOrderPlan[];
	/** The manifest the parked run left behind. */
	parked: ParkedRun;
	/** Whether the parked run's workspace is a linked worktree rather than the ticket's own checkout. */
	isolated?: boolean;
}) => {
	const { plan, status, willShip, pipeline = PipelineKind.Implement } = parked;

	const { cwd: primary } = setupBranchRepo({ branch: workOrderName });

	writeRepoFile({ cwd: primary, path: '.gitignore', content: '.lightsout/\n' });
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm ignore', { cwd: primary, stdio: 'ignore' });

	const workspace = isolated ? cutRunWorktree({ primary }) : primary;
	const record: WorkOrderState = { schemaVersion: 1, name: workOrderName, ticketRef: 'LO-140', branch: workOrderName, mode, plans, history: [] };

	writeRepoFile({ cwd: primary, path: join('.lightsout', 'work-orders', workOrderName, 'state.json'), content: JSON.stringify(record) });

	for (const entry of plans) {
		writeRepoFile({ cwd: primary, path: planPath({ planId: entry.id }), content: `# ${entry.title}\n` });
	}

	const seeded = setupResume({
		args: ['--run', runId],
		manifest: manifestOf({ pipeline, status, plan, ticketRef: 'LO-140', branch: workOrderName, workspace, willShip }),
	});

	writeRepoFile({ cwd: seeded.cwd, path: frozenTicketPath, content: '# Support multiple plans\n\nBuild the thing.\n' });

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockExitAfterImplement.mockResolvedValue(undefined);
	mockRunPipelineOrFailFast.mockResolvedValue({
		ok: true,
		manifest: manifestOf({ pipeline: PipelineKind.Implement, status: RunStatus.Passed, plan, ticketRef: 'LO-140', branch: workOrderName, workspace }),
	});
	mockRunDirectWork.mockResolvedValue({
		ok: true,
		manifest: manifestOf({ pipeline: PipelineKind.Direct, status: RunStatus.Passed, plan, ticketRef: 'LO-140', branch: workOrderName, workspace }),
	});

	return { primary, workspace, seededRecord: record, ...seeded };
};

describe('resumeCommand ticket plans', () => {
	test("resuming a failed ticket plan's run records it implemented under the same run", async () => {
		const { context, workspace } = setupTicketResume({
			plans: [
				planWith({
					id: planOne,
					progress: PlanProgress.Failed,
					implementation: { runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' },
				}),
			],
			parked: { plan: planPath({ planId: planOne }), status: RunStatus.Failed },
		});

		await resumeCommand(context);

		// a repair continues the implementation that already began, so the run it
		// is recorded under and the commit it started from both stand
		expect(readRecord({ workspace }).plans[0]).toEqual(
			expect.objectContaining({
				id: planOne,
				progress: 'implemented',
				implementation: expect.objectContaining({ runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' }),
			}),
		);
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledTimes(1);
	});

	test('resuming a run parked in a linked worktree records the plan in the primary checkout', async () => {
		const { context, primary, workspace } = setupTicketResume({
			plans: [
				planWith({
					id: planOne,
					progress: PlanProgress.Failed,
					implementation: { runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' },
				}),
			],
			parked: { plan: planPath({ planId: planOne }), status: RunStatus.Failed },
			isolated: true,
		});

		await resumeCommand(context);

		// the run's plan path is repo-relative and the folder it names is the
		// primary checkout's, so a tree that resolved it against itself would find
		// no plan there and the run would belong to nothing
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
		expect(readRecord({ workspace: primary }).plans[0]).toEqual(
			expect.objectContaining({ id: planOne, progress: 'implemented', implementation: expect.objectContaining({ runId }) }),
		);
	});

	test('refuses to resume the run of a plan excluded since it parked, changing nothing', async () => {
		const { context, cwd, workspace, errors, exitCodes } = setupTicketResume({
			plans: [
				planWith({ id: planOne, progress: PlanProgress.Implemented }),
				planWith({
					id: planTwo,
					progress: PlanProgress.Implementing,
					implementation: { runId, startedAt: '2026-03-04T09:00:00.000Z', startCommit: 'c0ffee2' },
					excludedFor: 'replaced by a later plan',
				}),
			],
			parked: { plan: planPath({ planId: planTwo }), status: RunStatus.PausedRateLimit, willShip: true },
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(planTwo);
		expect(exitCodes).toStrictEqual([1]);
		// the refusal lands before the tracker write, before the ship restamp and
		// before the pipeline, so a plan taken out of the order leaves no trace of
		// having been resumed
		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(readManifest({ cwd }).willShip).toBe(true);
		expect(readRecord({ workspace }).plans[1]?.progress).toBe('implementing');
	});

	test('refuses to resume a plan whose published files moved on another machine, changing nothing', async () => {
		const { context, workspace, errors, exitCodes } = setupTicketResume({
			mode: WorkOrderMode.SinglePlan,
			plans: [
				planWith({
					id: planOne,
					progress: PlanProgress.Failed,
					implementation: { runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' },
					publishedMarker: otherMachineMarker,
				}),
			],
			parked: { plan: planPath({ planId: planOne }), status: RunStatus.Failed },
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the ticket carries a published copy this machine never saw, so repairing
		// the copy here could build over another machine's work; the plan stays
		// exactly as the failed run left it
		expect(errors.join('\n')).toContain(planOne);
		expect(errors.join('\n')).toContain('lightsout work-order sync');
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(readRecord({ workspace }).plans[0]?.progress).toBe('failed');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('resumes a body build no plan of the record claims without touching the record', async () => {
		const { context, workspace, seededRecord } = setupTicketResume({
			mode: WorkOrderMode.SinglePlan,
			plans: [planWith({ id: planOne, progress: PlanProgress.Ready })],
			parked: { plan: frozenTicketPath, status: RunStatus.Failed, pipeline: PipelineKind.Direct },
		});

		await resumeCommand(context);

		// no plan folder in the run's path and no plan of the record naming this
		// run: nothing claims the build, so it resumes as it always has
		expect(mockRunDirectWork).toHaveBeenCalledTimes(1);
		expect(readRecord({ workspace })).toStrictEqual(seededRecord);
	});

	test('resuming a failed body build of plan 001 records the plan implemented', async () => {
		const { context, workspace } = setupTicketResume({
			mode: WorkOrderMode.SinglePlan,
			plans: [
				planWith({
					id: planOne,
					progress: PlanProgress.Failed,
					implementation: { runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' },
				}),
			],
			parked: { plan: frozenTicketPath, status: RunStatus.Failed, pipeline: PipelineKind.Direct },
		});

		await resumeCommand(context);

		// the run's plan path names no plan folder, so the plan it belongs to is
		// found by the run the record already names against it
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, existing: expect.objectContaining({ runId }) }));
		expect(readRecord({ workspace }).plans[0]).toEqual(
			expect.objectContaining({ id: planOne, progress: 'implemented', implementation: expect.objectContaining({ runId }) }),
		);
	});
});

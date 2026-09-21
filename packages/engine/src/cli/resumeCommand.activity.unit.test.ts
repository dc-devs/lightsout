import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type ActivityLevel, buildActivityTree, readActivityMarks } from '#src/activity/index.ts';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import {
	ActivityLevelKind,
	type LightsoutConfig,
	PipelineKind,
	PlanProgress,
	type RunManifest,
	RunStatus,
	TicketMode,
	type TicketRecord,
} from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { recordPlanCommandRun } from '#src/plan/index.ts';
import { manifestOf, runId, setupResume } from '#tests/helpers/setupResume.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// What this file pins is the activity record a resume writes — the marks in the
// plan folder, and the plan node they fold under. The record itself is written
// for real, because it is the observable result; what is doubled is everything
// that would spawn a harness or end the process on the way there.
type PipelineParams = { cwd: string; existing?: RunManifest; runId?: string; level?: ActivityLevel };
type DirectParams = {
	cwd: string;
	workspace: string;
	manifest: RunManifest;
	config: LightsoutConfig;
	driver: Driver;
	generated: string[] | undefined;
	willShip: boolean;
};
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
const mockRunPhasesOrFailFast = jest.fn<(params: PipelineParams) => Promise<PipelineResult>>();

jest.mock('#src/cli/common/utils/runPhasesOrFailFast.ts', () => ({
	runPhasesOrFailFast: (params: PipelineParams) => mockRunPhasesOrFailFast(params),
}));
// -------------------------
const mockContinueDirectRun = jest.fn<(params: DirectParams) => Promise<PipelineResult>>();

jest.mock('#src/cli/common/implementRun/continueDirectRun.ts', () => ({
	continueDirectRun: (params: DirectParams) => mockContinueDirectRun(params),
}));
// -------------------------
const mockRequireImplementLifecycle = jest.fn<(params: GuardParams) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: GuardParams) => mockRequireImplementLifecycle(params),
}));
// -------------------------
const mockExitAfterImplement = jest.fn<(params: ExitAfterImplementParams) => Promise<void>>();

jest.mock('#src/cli/common/utils/exitAfterImplement.ts', () => ({
	exitAfterImplement: (params: ExitAfterImplementParams) => mockExitAfterImplement(params),
}));
// -------------------------

/** The ticket's branch, which is also its folder's name under the plans directory. */
const ticketBranch = 'lo-154-implementation-activity';

/** The one plan of that ticket these cases resume a run of. */
const planId = '001-record-implementation';

/** The plan's address — the `--name` its plan folder, and so its activity record, is found by. */
const name = `${ticketBranch}/${planId}`;

/** Where that plan's deliverable sits, relative to the checkout the run builds in. */
const planPath = join('.lightsout', 'tickets', ticketBranch, 'plans', planId, 'plan.md');

/** Where that plan's overview sits when it is a phased plan — the plan path a phases run records. */
const overviewPath = join('.lightsout', 'tickets', ticketBranch, 'plans', planId, 'overview.md');

/** The ticket body a direct run froze beside itself — the plan path a build from the ticket body records. */
const frozenTicketPath = join('.lightsout', 'direct', 'runs', runId, 'ticket.md');

/** Every activity record anywhere under the checkout — how a case states that nothing was written. */
const activityRecordsUnder = async ({ dir }: { dir: string }) => {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });

	return entries.filter((entry) => entry.isFile() && entry.name === 'activity.jsonl').map((entry) => join(entry.parentPath, entry.name));
};

/**
 * A parked implement run of a plan under the plans directory, with the command
 * run its first invocation already recorded sitting in the plan folder.
 *
 * The manifest records no workspace, so the continuation builds in the checkout
 * it was launched from and there is exactly one directory the record could land
 * in. The ticket has no record, which is the legacy folder case: the lifecycle
 * runs the pipeline unchanged and nothing but the activity marks is written.
 */
const setupParkedImplementRun = () => {
	const seeded = setupResume({
		args: ['--run', runId],
		manifest: manifestOf({ pipeline: PipelineKind.Implement, status: RunStatus.Failed, plan: planPath, branch: ticketBranch }),
	});

	writeRepoFile({ cwd: seeded.cwd, path: planPath, content: '# Record the implementation\n' });

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockExitAfterImplement.mockResolvedValue(undefined);
	mockRunPipelineOrFailFast.mockResolvedValue({
		ok: true,
		manifest: manifestOf({ pipeline: PipelineKind.Implement, status: RunStatus.Passed, plan: planPath, branch: ticketBranch }),
	});

	return { ...seeded, planDir: join(seeded.cwd, '.lightsout', 'tickets', ticketBranch, 'plans', planId) };
};

/**
 * A parked PHASED run of the same plan, whose continued sequence opens one pass
 * level from whatever level it is handed.
 *
 * The coordinator is doubled because it spawns a harness, so the pass level it
 * would open is opened here instead — which is how a case can see that the
 * command-run level reached the phased door at all, rather than only that the
 * command run itself was recorded.
 */
const setupParkedPhasedRun = () => {
	const seeded = setupResume({
		args: ['--run', runId],
		manifest: manifestOf({ pipeline: PipelineKind.Phases, status: RunStatus.Failed, plan: overviewPath, branch: ticketBranch }),
	});

	writeRepoFile({ cwd: seeded.cwd, path: overviewPath, content: '# Record the implementation\n' });

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockExitAfterImplement.mockResolvedValue(undefined);
	mockRunPhasesOrFailFast.mockImplementation(async ({ level }) => {
		const pass = level?.open({ level: ActivityLevelKind.Pass, label: 'phase 2/2: phase2-record.md' });

		pass?.close({ outcome: RunStatus.Passed });

		return {
			ok: true,
			manifest: manifestOf({ pipeline: PipelineKind.Phases, status: RunStatus.Passed, plan: overviewPath, branch: ticketBranch }),
		};
	});

	return { ...seeded, planDir: join(seeded.cwd, '.lightsout', 'tickets', ticketBranch, 'plans', planId) };
};

/**
 * A parked DIRECT run whose ticket record names a plan against this run's id.
 *
 * That is what makes the case sharp: the run's own plan path is a frozen ticket
 * body, so the plan it belongs to is found through the record — a name the
 * wrapper would happily record under if the direct pipeline were not suppressed.
 * The plan folder is on disk for the same reason, so an unsuppressed record has
 * somewhere obvious to land.
 */
const setupParkedDirectRun = () => {
	const seeded = setupResume({
		args: ['--run', runId],
		manifest: manifestOf({ pipeline: PipelineKind.Direct, status: RunStatus.Failed, plan: frozenTicketPath, ticketRef: 'LO-154', branch: ticketBranch }),
	});
	const record: TicketRecord = {
		schemaVersion: 1,
		ticketRef: 'LO-154',
		branch: ticketBranch,
		mode: TicketMode.SinglePlan,
		plans: [
			{
				id: planId,
				title: 'Record the implementation',
				progress: PlanProgress.Failed,
				createdAt: '2026-03-01T00:00:00.000Z',
				implementation: { runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' },
			},
		],
		history: [],
	};

	writeRepoFile({ cwd: seeded.cwd, path: planPath, content: '# Record the implementation\n' });
	writeRepoFile({ cwd: seeded.cwd, path: join('.lightsout', 'tickets', ticketBranch, 'ticket.json'), content: JSON.stringify(record) });
	writeRepoFile({ cwd: seeded.cwd, path: frozenTicketPath, content: '# Record the implementation\n\nBuild the thing.\n' });

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockExitAfterImplement.mockResolvedValue(undefined);
	mockContinueDirectRun.mockResolvedValue({
		ok: true,
		manifest: manifestOf({ pipeline: PipelineKind.Direct, status: RunStatus.Passed, plan: frozenTicketPath, branch: ticketBranch }),
	});

	return seeded;
};

describe('resumeCommand activity record', () => {
	test('a resume adds a second command run under the same plan level', async () => {
		const { context, cwd, planDir, errors } = setupParkedImplementRun();

		await recordPlanCommandRun({ cwd, name, label: 'implement', work: async () => 'parked', statusOf: () => RunStatus.Failed });

		await resumeCommand(context);

		const report = buildActivityTree({ plan: name, marks: await readActivityMarks({ dir: planDir }) });
		const [root] = report.roots;

		// a root level's id IS its label, so the continuation folds under the plan
		// node the first run wrote rather than starting a second one beside it
		expect(report.roots).toHaveLength(1);
		expect(root).toEqual(expect.objectContaining({ level: 'plan', label: name }));
		expect(root?.children.map((child) => ({ level: child.level, label: child.label, outcome: child.outcome }))).toStrictEqual([
			{ level: 'command-run', label: 'implement', outcome: 'failed' },
			{ level: 'command-run', label: 'resume', outcome: 'passed' },
		]);
		expect(errors).toStrictEqual([]);
	});

	test('the level it opens is the one the continued pipeline hangs its work from', async () => {
		const { context, planDir, errors } = setupParkedImplementRun();

		mockRunPipelineOrFailFast.mockImplementation(async ({ level }) => {
			const step = level?.open({ level: ActivityLevelKind.Step, label: 'write-tests' });

			step?.close({ outcome: RunStatus.Passed });

			return {
				ok: true,
				manifest: manifestOf({ pipeline: PipelineKind.Implement, status: RunStatus.Passed, plan: planPath, branch: ticketBranch }),
			};
		});

		await resumeCommand(context);

		const report = buildActivityTree({ plan: name, marks: await readActivityMarks({ dir: planDir }) });
		const [root] = report.roots;
		const [commandRun] = root?.children ?? [];

		// the continuation's own steps sit under the resume's row, which only holds
		// if the open level was handed to the pipeline rather than dropped
		expect(commandRun).toEqual(expect.objectContaining({ level: 'command-run', label: 'resume', outcome: 'passed' }));
		expect(commandRun?.children.map((child) => ({ level: child.level, label: child.label, outcome: child.outcome }))).toStrictEqual([
			{ level: 'step', label: 'write-tests', outcome: 'passed' },
		]);
		expect(errors).toStrictEqual([]);
	});

	test('a resumed phased sequence hangs its phases from the same command run', async () => {
		const { context, planDir, errors } = setupParkedPhasedRun();

		await resumeCommand(context);

		const report = buildActivityTree({ plan: name, marks: await readActivityMarks({ dir: planDir }) });
		const [root] = report.roots;
		const [commandRun] = root?.children ?? [];

		// the phased door takes the level the same way the single-run door does, so
		// one resumed sequence is one command run holding its phases
		expect(root).toEqual(expect.objectContaining({ level: 'plan', label: name }));
		expect(commandRun).toEqual(expect.objectContaining({ level: 'command-run', label: 'resume', outcome: 'passed' }));
		expect(commandRun?.children.map((child) => ({ level: child.level, label: child.label, outcome: child.outcome }))).toStrictEqual([
			{ level: 'pass', label: 'phase 2/2: phase2-record.md', outcome: 'passed' },
		]);
		expect(errors).toStrictEqual([]);
	});

	test('a resumed direct run records nothing', async () => {
		const { context, cwd, errors } = setupParkedDirectRun();

		await resumeCommand(context);

		// the direct pipeline is outside this record's scope, and its plan path is a
		// ticket body — so the name the ticket record answers is deliberately not
		// recorded under, while the continuation itself runs exactly as it always has
		expect(await activityRecordsUnder({ dir: cwd })).toStrictEqual([]);
		expect(mockContinueDirectRun).toHaveBeenCalledWith(expect.objectContaining({ cwd, workspace: cwd, manifest: expect.objectContaining({ runId }) }));
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: true }) }));
		expect(errors).toStrictEqual([]);
	});
});

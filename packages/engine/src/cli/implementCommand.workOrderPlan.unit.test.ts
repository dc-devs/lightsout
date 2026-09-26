import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { ShipResult } from '#src/contracts/ship/ShipResult.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { manifestOf } from '#tests/helpers/setupResume.ts';

// Mocked Imports
// -------------------------
// The pipeline is the one seam every case sets for itself: two rows script a
// pass no harness could produce, one row must prove the pipeline never started,
// and the stamping row wants the real one — which mints the manifest, records
// the intent on it, and then fails at a plan file that is not there, before any
// harness is spawned. The ticket record, the order rules and the progress
// writing all run for real throughout.
const { runPipelineOrFailFast: actualRunPipeline } = jest.requireActual<typeof import('#src/cli/internal/common/utils/runPipelineOrFailFast.ts')>(
	'#src/cli/internal/common/utils/runPipelineOrFailFast.ts',
);

type PipelineParams = Parameters<typeof actualRunPipeline>[0];

const mockRunPipelineOrFailFast = jest.fn<(params: PipelineParams) => Promise<PipelineResult>>();

jest.mock('#src/cli/internal/common/utils/runPipelineOrFailFast.ts', () => ({
	runPipelineOrFailFast: (params: PipelineParams) => mockRunPipelineOrFailFast(params),
}));
// -------------------------
// The merge is the one step that would leave the machine, and whether it is
// reached at all is the claim of the single-phase row.
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/ship/runShip.ts', () => ({ runShip: (params: { cwd: string }) => mockRunShip(params) }));
// -------------------------
// Whether the tracker was written to before the run is what a refused plan has
// to answer for, so the pre-source lifecycle write is a spy rather than a call.
const mockRequireImplementLifecycle = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/requireImplementLifecycle.ts', () => ({
	requireImplementLifecycle: (params: { cwd: string }) => mockRequireImplementLifecycle(params),
}));
// -------------------------
// The temp repo has no remote and git cannot cut a tree for it; the refusal row
// asserts this was never reached at all.
const mockCreateWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | { error: string }>>();
const mockFetchDefaultBranch = jest.fn<(params: { cwd: string }) => Promise<string | { error: string }>>();

jest.mock('#src/worktree/createWorktree.ts', () => ({ createWorktree: (params: { cwd: string; branch: string }) => mockCreateWorktree(params) }));
jest.mock('#src/worktree/fetchDefaultBranch.ts', () => ({ fetchDefaultBranch: (params: { cwd: string }) => mockFetchDefaultBranch(params) }));
// -------------------------
// The report card reads a run directory a scripted pipeline never filled in.
const mockPrintResult = jest.fn<(params: { result: PipelineResult; cwd: string }) => Promise<void>>();

jest.mock('#src/cli/internal/common/render/printResult.ts', () => ({
	printResult: (params: { result: PipelineResult; cwd: string }) => mockPrintResult(params),
}));
// -------------------------

/** The ticket folder two plans of one ticket share, and the branch its name yields. */
const workOrderName = 'lo-7-search';
const workOrderFolder = join('.lightsout', 'work-orders', workOrderName);
const firstPlan = '001-basics';
const laterPlan = '002-ranking';
const firstPlanFolder = join(workOrderFolder, 'plans', firstPlan);
const laterPlanFolder = join(workOrderFolder, 'plans', laterPlan);

const planBody = '# Plan: the basics\n';
const overviewBody = '# Ranking — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n| 1 | `phase1.md` | scope |\n';
const phaseBody = '# Ranking — Phase 1\n';

/** A marker some other machine published: 64 lowercase hex characters, as the record spells one. */
const otherMachineMarker = '7c'.repeat(32);

/** One plan of a ticket's record, carrying only what the order and shipping rules read. */
const planOf = ({ id, progress, publishedMarker }: { id: string; progress: PlanProgress; publishedMarker?: string }): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-03-01T00:00:00.000Z',
	...(publishedMarker === undefined ? {} : { publishedMarker }),
});

/** A ticket record on the branch above, in whichever mode, with whichever plans and whichever approved plan set the case needs. */
const recordOf = ({
	mode = WorkOrderMode.MultiplePlan,
	plans,
	shipRequest,
}: {
	mode?: WorkOrderMode;
	plans: WorkOrderPlan[];
	/** The plan ids an explicit ship request names, or nothing when the ticket carries no request. */
	shipRequest?: string[];
}): WorkOrderState => ({
	schemaVersion: 1,
	name: workOrderName,
	ticketRef: 'LO-7',
	branch: workOrderName,
	mode,
	plans,
	...(shipRequest === undefined ? {} : { shipRequest: { planIds: shipRequest, requestedAt: '2026-03-04T09:00:00.000Z' } }),
	history: [],
});

/** The ticket record as it stands on disk after the command — the primary checkout holds the one copy. */
const readRecord = ({ cwd }: { cwd: string }): WorkOrderState => JSON.parse(readFileSync(join(cwd, workOrderFolder, 'state.json'), 'utf8')) as WorkOrderState;

/** Every run the command left on disk, by id. */
const readRunIds = ({ cwd }: { cwd: string }): string[] => {
	// A run of a ticket's plan is filed under that ticket's own runs folder.
	const runs = dirname(runDirFor({ cwd, runId: 'any', workOrderName }));

	return existsSync(runs) ? readdirSync(runs) : [];
};

/** Every manifest the command left on disk — the record the progress view later draws its ship row from. */
const readManifests = ({ cwd }: { cwd: string }): { runId: string; willShip?: boolean }[] =>
	readRunIds({ cwd }).map(
		(runId) => JSON.parse(readFileSync(join(runDirFor({ cwd, runId, workOrderName }), 'manifest.json'), 'utf8')) as { runId: string; willShip?: boolean },
	);

/**
 * A real consumer repo holding one ticket's record beside the addressed plan's
 * own folder, with everything downstream of the pipeline quiet.
 *
 * The record is written by hand rather than through the ticket commands: what
 * these cases are about is what `implement` does with a record that already
 * says something, and writing it directly is what lets a case state exactly
 * that.
 */
const seedTicketRepo = ({ record, files }: { record: WorkOrderState; files: Record<string, string> }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();

	mkdirSync(join(cwd, workOrderFolder), { recursive: true });
	writeFileSync(join(cwd, workOrderFolder, 'state.json'), `${JSON.stringify(record, undefined, '\t')}\n`);

	for (const [path, body] of Object.entries(files)) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), body);
	}

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockPrintResult.mockResolvedValue(undefined);
	mockFetchDefaultBranch.mockResolvedValue('main');
	mockCreateWorktree.mockResolvedValue({ error: 'no tree may be cut for a plan the ticket record refuses' });

	return { cwd, ...captured };
};

/**
 * A run of a ticket plan whose pipeline passes, writing the manifest a real run
 * would have written — under exactly the id the lifecycle handed it, which is
 * what lets a case ask whether the id the record names is a run that exists.
 */
const setupPassedTicketRun = ({
	record,
	files,
	planPath,
	extraArgs = [],
}: {
	record: WorkOrderState;
	files: Record<string, string>;
	/** The `--plan` value, which is also what the manifest records as the run's plan. */
	planPath: string;
	extraArgs?: string[];
}) => {
	const seeded = seedTicketRepo({ record, files });

	mockRunPipelineOrFailFast.mockImplementation(async ({ cwd: runCwd, runId }) => {
		if (runId === undefined) {
			throw new Error('the pipeline was started with no pre-minted run id, so no manifest could carry the id the record names');
		}

		const manifest = manifestOf({ runId, plan: planPath, status: RunStatus.Passed });

		// A run of a ticket's plan is filed under that ticket's own runs folder.
		const runDir = runDirFor({ cwd: runCwd, runId, workOrderName });

		mkdirSync(runDir, { recursive: true });
		writeFileSync(join(runDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

		return { ok: true, manifest };
	});

	const args = ['--plan', planPath, '--no-worktree', ...extraArgs];

	return { context: { flags: parseFlags({ args }), rest: [], cwd: seeded.cwd }, ...seeded };
};

/** A run of a plan the record blocks: the pipeline is armed to fail loudly, because reaching it at all is the defect. */
const setupRefusedTicketRun = ({
	record,
	planFolder = laterPlanFolder,
	noWorktree = false,
}: {
	record: WorkOrderState;
	planFolder?: string;
	/** Whether the run stays in the launching checkout, for a refusal that only lands once a workspace is open. */
	noWorktree?: boolean;
}) => {
	const seeded = seedTicketRepo({ record, files: { [join(planFolder, 'plan.md')]: planBody } });

	mockRunPipelineOrFailFast.mockImplementation(() => {
		throw new Error('the pipeline ran for a plan the ticket record does not allow to be built');
	});

	const args = ['--plan', join(planFolder, 'plan.md'), ...(noWorktree ? ['--no-worktree'] : [])];

	return { context: { flags: parseFlags({ args }), rest: [], cwd: seeded.cwd }, ...seeded };
};

/**
 * A run of a ticket plan through the REAL pipeline, pointed at a plan file that
 * is not there: the run mints its manifest and stamps the intent on it, then
 * fails at the plan read before a harness is spawned, leaving the stamp as the
 * only thing the case has to read.
 */
const setupStampedTicketRun = ({ record }: { record: WorkOrderState }) => {
	const seeded = seedTicketRepo({ record, files: { [join(laterPlanFolder, 'notes.md')]: '# research notes, not the plan\n' } });

	mockRunPipelineOrFailFast.mockImplementation(actualRunPipeline);

	const args = ['--plan', join(laterPlanFolder, 'plan.md'), '--no-worktree'];

	return { context: { flags: parseFlags({ args }), rest: [], cwd: seeded.cwd }, ...seeded };
};

describe('implementCommand ticket plans', () => {
	test('a passed single-phase run of a ticket plan prints its note and does not chain into ship', async () => {
		const { context, logged, exitCodes } = setupPassedTicketRun({
			record: recordOf({
				plans: [planOf({ id: firstPlan, progress: PlanProgress.Implemented }), planOf({ id: laterPlan, progress: PlanProgress.Ready })],
				shipRequest: [firstPlan, laterPlan],
			}),
			files: { [join(laterPlanFolder, 'overview.md')]: overviewBody, [join(laterPlanFolder, 'phase1.md')]: phaseBody },
			planPath: join(laterPlanFolder, 'phase1.md'),
			extraArgs: ['--overview', join(laterPlanFolder, 'overview.md')],
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		// one phase of the plan passing is not the plan's implementation, so the
		// run is never allowed to satisfy the ticket's request — the stamp the
		// pipeline is handed says so, and the merge is never reached
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ willShip: false }));
		expect(mockRunShip).not.toHaveBeenCalled();
		expect(logged.some((line) => /has not finished/.test(line))).toBe(true);
		// a passed run that deliberately did not ship is still a passed run
		expect(exitCodes).toStrictEqual([0]);
	});

	test('refuses a plan whose lower-numbered plan is not implemented before any worktree or tracker write', async () => {
		const { context, cwd, errors, exitCodes } = setupRefusedTicketRun({
			record: recordOf({ plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: laterPlan, progress: PlanProgress.Ready })] }),
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(firstPlan);
		// nothing was cut, nothing was told the ticket had started, and no run
		// exists to be resumed: the refusal lands before any of the three
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(readRunIds({ cwd })).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses a plan whose published files moved on another machine, leaving the record untouched', async () => {
		const published = planOf({ id: firstPlan, progress: PlanProgress.Ready, publishedMarker: otherMachineMarker });
		const { context, cwd, errors, exitCodes } = setupRefusedTicketRun({
			record: recordOf({ mode: WorkOrderMode.SinglePlan, plans: [published] }),
			planFolder: firstPlanFolder,
			noWorktree: true,
		});
		const before = readFileSync(join(cwd, workOrderFolder, 'state.json'), 'utf8');

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		// the ticket carries a published copy this machine never saw, so the folder
		// here may be older than it — building it would silently drop the other
		// machine's work, and the sentence says which command settles that
		expect(errors.join('\n')).toContain(firstPlan);
		expect(errors.join('\n')).toContain('lightsout work-order sync');
		expect(readFileSync(join(cwd, workOrderFolder, 'state.json'), 'utf8')).toBe(before);
		expect(readRunIds({ cwd })).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('records a ticket plan implemented under the run id of the manifest it wrote', async () => {
		const { context, cwd, exitCodes } = setupPassedTicketRun({
			record: recordOf({ mode: WorkOrderMode.SinglePlan, plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })] }),
			files: { [join(firstPlanFolder, 'plan.md')]: planBody },
			planPath: join(firstPlanFolder, 'plan.md'),
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		const [plan] = readRecord({ cwd }).plans;
		expectDefined(plan);
		expectDefined(plan.implementation);
		// the id on the record is the id of the one run on disk, so a reader
		// following the record reaches a manifest rather than nothing
		expect(readRunIds({ cwd })).toStrictEqual([plan.implementation.runId]);
		expect(plan.progress).toBe('implemented');
		expect(exitCodes).toStrictEqual([0]);
	});

	test.each([
		{ shipRequest: [firstPlan, laterPlan], willShip: true },
		{ shipRequest: undefined, willShip: false },
	])("stamps the manifest to ship when this run will satisfy the ticket's ship request", async ({ shipRequest, willShip }) => {
		const { context, cwd } = setupStampedTicketRun({
			record: recordOf({
				plans: [planOf({ id: firstPlan, progress: PlanProgress.Implemented }), planOf({ id: laterPlan, progress: PlanProgress.Ready })],
				shipRequest,
			}),
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		// neither `--ship` nor `ship.after-implement` was given: for a
		// multiple-plan ticket the request alone decides, and the row the progress
		// view draws has to say the same thing the chain will do
		expect(readManifests({ cwd })).toEqual([expect.objectContaining({ willShip })]);
	});
});

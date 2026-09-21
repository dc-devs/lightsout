import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import {
	type LightsoutConfig,
	PlanProgress,
	type RunManifest,
	RunStatus,
	TicketEventKind,
	TicketMode,
	type TicketPlan,
	type TicketRecord,
} from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { runPlanFolderPipeline } from '#src/queue/workers/runPlanFolderPipeline.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** What either pipeline is handed: the two the folder's shape chooses between differ only in which path they carry. */
interface PipelineCall {
	cwd: string;
	config: LightsoutConfig;
	driver: Driver;
	planPath?: string;
	overviewPath?: string;
	onProgress?: (message: string) => void;
}

// Mocked Imports
// -------------------------
// Both pipelines spawn a harness against a real repository, and each is covered
// by its own tests. What this file owns is which of the two a plan folder's
// shape selects, the path it is pointed at, and how its result is stated in the
// queue's own terms — all observable with them stubbed.
const mockRunPhasesPipeline = jest.fn<(params: PipelineCall) => Promise<PipelineResult>>();

jest.mock('#src/phases/index.ts', () => ({
	runPhasesPipeline: (params: PipelineCall) => mockRunPhasesPipeline(params),
}));
// -------------------------
const mockRunImplementPipeline = jest.fn<(params: PipelineCall) => Promise<PipelineResult>>();

jest.mock('#src/pipeline/index.ts', () => ({
	runImplementPipeline: (params: PipelineCall) => mockRunImplementPipeline(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const manifestOf = (status: RunStatus): RunManifest => ({
	runId: 'run-7',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:01.000Z',
	plan: '.lightsout/tickets/lo-75-queue-owns-the-build/plans/plan.md',
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

/**
 * A real worktree on disk holding one plan folder, since the phased check reads
 * the tree rather than being told. `phased` adds the overview file that makes it
 * one; `result` is what whichever pipeline runs reports back.
 */
const setupPlanFolder = ({
	phased = false,
	result = { ok: true, manifest: manifestOf(RunStatus.Passed) },
}: {
	phased?: boolean;
	result?: PipelineResult;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-folder-'));
	const name = 'lo-75-queue-owns-the-build';
	const folder = planWorkspaceFolder({ cwd: cwd, name: name });

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'plan.md'), '# Plan\n');

	if (phased) {
		writeFileSync(join(folder, 'overview.md'), '# Overview\n');
	}

	mockRunPhasesPipeline.mockResolvedValue(result);
	mockRunImplementPipeline.mockResolvedValue(result);

	const onProgress = jest.fn<(message: string) => void>();

	return { cwd, name, folder, onProgress };
};

/** The ticket folder's name, which is also the branch every plan below implements on. */
const ticketBranch = 'lo-140-multiple-plans';
const firstPlan = '001-queue-build';
const secondPlan = '002-open-outcome';

const planOf = ({ id, progress }: { id: string; progress: PlanProgress }): TicketPlan => ({
	id,
	title: `plan ${id}`,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
});

/** A passed run of the whole plan, which is the only shape that finishes a plan's implementation. */
const passedPlanManifest = ({ planId }: { planId: string }): RunManifest => ({
	...manifestOf(RunStatus.Passed),
	plan: join('.lightsout', 'tickets', ticketBranch, 'plans', planId, 'plan.md'),
});

/**
 * A real repository standing on the ticket branch, holding the ticket's record
 * and one folder per plan — the three things the ticket lifecycle reads: the
 * record for the order the plans build in, `HEAD` for where an implementation
 * starts, and each plan's own files for the snapshot a pass records.
 */
const setupTicketPlanFolder = ({ plans, result }: { plans: TicketPlan[]; result: PipelineResult }) => {
	const { cwd } = setupBranchRepo({ branch: ticketBranch });
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);
	const record: TicketRecord = {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: ticketBranch,
		mode: TicketMode.MultiplePlan,
		plans,
		history: [{ at: '2026-01-01T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail: `added plan ${firstPlan}` }],
	};

	mkdirSync(ticketFolder, { recursive: true });

	for (const plan of plans) {
		mkdirSync(join(ticketFolder, 'plans', plan.id), { recursive: true });
		writeFileSync(join(ticketFolder, 'plans', plan.id, 'plan.md'), `# ${plan.id}\n`);
	}

	writeFileSync(join(ticketFolder, 'ticket.json'), JSON.stringify(record));
	mockRunPhasesPipeline.mockResolvedValue(result);
	mockRunImplementPipeline.mockResolvedValue(result);

	const onProgress = jest.fn<(message: string) => void>();

	return { cwd, ticketFolder, onProgress };
};

/** One plan's entry in the ticket's record as it stands on disk once the call has returned. */
const planAt = ({ ticketFolder, id }: { ticketFolder: string; id: string }) =>
	(JSON.parse(readFileSync(join(ticketFolder, 'ticket.json'), 'utf8')) as TicketRecord).plans.find((plan) => plan.id === id);

describe('runPlanFolderPipeline', () => {
	test('runs the phases pipeline against the overview a phased plan folder holds', async () => {
		const { cwd, name, folder, onProgress } = setupPlanFolder({ phased: true });

		const outcome = await runPlanFolderPipeline({ cwd, name, config, driver, onProgress });

		expect(mockRunPhasesPipeline).toHaveBeenCalledWith(expect.objectContaining({ cwd, config, driver, overviewPath: join(folder, 'overview.md'), onProgress }));
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
		expect(outcome).toStrictEqual({});
	});

	test('runs the implement pipeline against the plan file when the folder is not phased', async () => {
		const { cwd, name, folder, onProgress } = setupPlanFolder();

		const outcome = await runPlanFolderPipeline({ cwd, name, config, driver, onProgress });

		expect(mockRunImplementPipeline).toHaveBeenCalledWith(expect.objectContaining({ cwd, config, driver, planPath: join(folder, 'plan.md'), onProgress }));
		expect(mockRunPhasesPipeline).not.toHaveBeenCalled();
		expect(outcome).toStrictEqual({});
	});

	test('parks a failed build with the resume sentence naming the run it continues', async () => {
		const { cwd, name, onProgress } = setupPlanFolder({ result: { ok: false, error: 'the gates stayed red', manifest: manifestOf(RunStatus.Failed) } });

		const outcome = await runPlanFolderPipeline({ cwd, name, config, driver, onProgress });

		// the worktree is left standing, so the sentence a human reads is the one
		// command that picks the run back up where it stopped
		expect(outcome).toEqual({ error: expect.stringMatching(/^the gates stayed red\b.*`lightsout resume --run run-7`/) });
	});

	test('names the state a pipeline ended in when it stopped without saying why', async () => {
		const { cwd, name, onProgress } = setupPlanFolder({ result: { ok: false, manifest: manifestOf(RunStatus.Escalated) } });

		const outcome = await runPlanFolderPipeline({ cwd, name, config, driver, onProgress });

		// a run that stated no reason still has a state, and naming it beats an
		// empty error nobody can act on
		expect(outcome).toEqual({ error: expect.stringMatching(/^the run ended escalated\b.*`lightsout resume --run run-7`/) });
	});

	test('returns the ticket refusal as the worker error without building a blocked plan', async () => {
		const { cwd, ticketFolder, onProgress } = setupTicketPlanFolder({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Ready })],
			result: { ok: true, manifest: passedPlanManifest({ planId: secondPlan }) },
		});

		const outcome = await runPlanFolderPipeline({ cwd, name: `${ticketBranch}/${secondPlan}`, config, driver, onProgress });

		// a ticket's plans implement in numeric order, so the plan standing in the
		// way is named and nothing is built or recorded for the one that is blocked
		expect(outcome).toEqual({ error: expect.stringContaining(firstPlan) });
		expect(outcome.error).toMatch(/implementation has not finished/);
		expect(mockRunImplementPipeline).not.toHaveBeenCalled();
		expect(mockRunPhasesPipeline).not.toHaveBeenCalled();
		expect(planAt({ ticketFolder, id: secondPlan })?.progress).toBe('ready');
	});

	test('records a queued ticket plan implemented once its build passes', async () => {
		const { cwd, ticketFolder, onProgress } = setupTicketPlanFolder({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			result: { ok: true, manifest: passedPlanManifest({ planId: firstPlan }) },
		});

		const outcome = await runPlanFolderPipeline({ cwd, name: `${ticketBranch}/${firstPlan}`, config, driver, onProgress });

		expect(outcome).toStrictEqual({});
		expect(planAt({ ticketFolder, id: firstPlan })).toEqual(
			expect.objectContaining({ progress: 'implemented', implementation: expect.objectContaining({ finishedAt: expect.any(String) }) }),
		);
	});
});

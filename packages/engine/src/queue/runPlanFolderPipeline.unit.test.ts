import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { runPlanFolderPipeline } from '#src/queue/runPlanFolderPipeline.ts';

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
	plan: '.lightsout/plans/lo-75-queue-owns-the-build/plan.md',
	harness: 'claude-code',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	ledgerTests: [],
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
	const folder = join(cwd, '.lightsout', 'plans', name);

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
});

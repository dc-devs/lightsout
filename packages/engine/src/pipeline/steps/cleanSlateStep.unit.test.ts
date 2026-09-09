import { describe, expect, jest, test } from '@jest/globals';
import type { AcceptanceRow } from '#src/common/types/AcceptanceRow.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { cleanSlateStep } from '#src/pipeline/steps/cleanSlateStep.ts';

// Mocked Imports
// -------------------------
// The gates are the one thing this step reads a verdict from, and they have
// their own tests. What is under test here is what the step does with a
// verdict, so the verdict is handed to it directly.
interface GateParams {
	run: PipelineRun;
	coverage?: boolean;
	checkpoint: string;
	rows: AcceptanceRow[];
	final?: boolean;
}

const mockRunVerificationGates = jest.fn<(params: GateParams) => Promise<VerificationResult>>();

jest.mock('#src/pipeline/common/utils/runVerificationGates.ts', () => ({
	runVerificationGates: (params: GateParams) => mockRunVerificationGates(params),
}));
// -------------------------

/**
 * A PipelineRun stub carrying only what clean-slate touches before it answers:
 * the manifest it reads, the progress it prints, and a stop that is captured
 * rather than thrown.
 */
const setupCleanSlateRun = ({ result }: { result: VerificationResult }) => {
	mockRunVerificationGates.mockResolvedValue(result);

	const manifest = {
		runId: 'run-1',
		steps: [],
		changedFiles: [],
		packages: [],
		baselineDirtyFiles: [],
		approvedTests: [],
		currentStep: null,
	} as unknown as RunManifest;
	const progress: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;

	const run = {
		cwd: '/tmp/lightsout-clean-slate',
		config: {} as unknown as LightsoutConfig,
		current: () => manifest,
		progress: (message: string) => progress.push(message),
		nextRecord: ({ id }: { id: string }) => ({ id, status: RunStatus.Running, attempts: 1 }),
		setStep: async ({ record }: { record: StepRecord }) => {
			manifest.steps = [record];
		},
		stop: async ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }) => {
			stopped = { status, error };
			manifest.steps = [{ ...record, status, error }];

			return { ok: false as const, manifest, error };
		},
	};

	return { run: run as unknown as PipelineRun, progress, steps: () => manifest.steps, stopped: () => stopped };
};

describe('cleanSlateStep', () => {
	test('cleanSlateStep: a coordination failure stops escalated instead of calling the codebase not green', async () => {
		const coordination = 'gates never started: run run-7 in /tmp/worktrees/lo-118 has held the machine for 31m, and this run waited its full 30m for it';
		const { run, steps, stopped } = setupCleanSlateRun({
			result: { error: coordination, failedFamilies: [], crashes: [], coordination, failures: [], gates: [] },
		});

		const outcome = await cleanSlateStep({ run, ledgerGates: [] })();

		// No gate command executed, so the run has no evidence at all about the
		// consumer's code: it escalates naming the machine rather than failing
		// with the headline that says the codebase is not green.
		expect(stopped()).toEqual(expect.objectContaining({ status: RunStatus.Escalated }));
		expect(outcome?.error).toEqual(expect.stringContaining(coordination));
		expect(outcome?.error).not.toMatch(/not green before implementation/i);
		expect(steps()[0]).toEqual(expect.objectContaining({ id: 'clean-slate', status: RunStatus.Escalated }));
	});
});

import { expect, jest, test } from '@jest/globals';
import type { AcceptanceRow } from '#src/common/types/AcceptanceRow.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/index.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';

// Mocked Imports
// -------------------------
// The review has its own suite and its own verdict rules. What is under test
// here is only what a checkpoint that re-enters through the formatter does with
// a throttled reviewer, so the answer is handed back directly.
interface ReviewParams {
	run: PipelineRun;
	checkpoint: string;
	planContent: string;
	overviewContent?: string;
}

const mockReviewTestChanges = jest.fn<(params: ReviewParams) => Promise<{ error?: string; rateLimited?: boolean }>>();

jest.mock('#src/pipeline/approvedTests/index.ts', () => ({
	reviewTestChanges: (params: ReviewParams) => mockReviewTestChanges(params),
	// What the post-gate snapshot approval reaches for. It has its own test;
	// here it must simply do nothing.
	approveTestFiles: async () => [],
	readApprovedTest: async () => undefined,
	removeApprovedTests: async () => {},
}));
// -------------------------
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
interface FormatterParams {
	cwd: string;
	runId: string;
	config: LightsoutConfig;
	step: string;
}

const mockRunFormatter = jest.fn<(params: FormatterParams) => Promise<string | undefined>>();

jest.mock('#src/common/processes/runFormatter.ts', () => ({
	runFormatter: (params: FormatterParams) => mockRunFormatter(params),
}));
// -------------------------

const checkpoint = 'verify-implement';

/**
 * A checkpoint that owes a formatter pass — the state a repair attempt re-enters
 * by — over a `PipelineRun` stub whose stops are captured rather than thrown.
 */
const setupFormattingReentry = () => {
	mockRunFormatter.mockResolvedValue(undefined);
	mockReviewTestChanges.mockResolvedValue({ rateLimited: true });
	mockRunVerificationGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], failures: [], gates: [] });

	const owedFormatting = { failedFamilies: [], repairAttempts: {}, failures: [], needsFormatting: true, guidedRepairAttempted: false };
	const steps: StepRecord[] = [{ id: checkpoint, status: RunStatus.Running, attempts: 1, verification: owedFormatting }];
	const manifest = { runId: 'run-1', steps, changedFiles: [], packages: [], acceptanceTests: [], approvedTests: [] } as unknown as RunManifest;
	const roleInvocations: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;

	const run = {
		cwd: '/tmp/lightsout-verify-step-coverage',
		config: {} as unknown as LightsoutConfig,
		driver: createUncalledDriver({ reason: 'a checkpoint the reviewer never ruled on may not spawn an agent' }),
		current: () => manifest,
		progress: () => {},
		parkMessage: () => 'run parked: harness rate limited',
		nextRecord: ({ id }: { id: string }) => ({ id, status: RunStatus.Running, attempts: 2 }),
		setStep: async ({ record }: { record: StepRecord }) => {
			manifest.steps = [record];
		},
		update: async () => {},
		stop: async ({ status, error }: { status: RunStatus; error: string }) => {
			stopped = { status, error };

			return { ok: false as const, manifest, error };
		},
		invokeRole: async ({ step }: { step: string }) => {
			roleInvocations.push(step);

			return { ok: false as const, rateLimited: false, error: 'no fix role should run here' };
		},
		agentEventSink: () => () => {},
		persistRejected: () => async () => {},
		recordUsage: async () => {},
	};

	const buildFix = () => ({ systemPrompt: 'repair the checkpoint', prompt: 'repair the checkpoint' });

	return { run: run as unknown as PipelineRun, manifest, buildFix, roleInvocations, stopped: () => stopped };
};

test('verifyStep: a rate-limited reviewer parks the run on the re-entry that owes a formatter pass', async () => {
	const { run, manifest, buildFix, roleInvocations, stopped } = setupFormattingReentry();

	const parked = await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => [], buildFix })();

	// The formatter settles the tree first, so the reviewer reads the bytes the
	// gates would see. When that reviewer is throttled it said nothing about the
	// tests: there is no verdict to repair and no failure to escalate, so the run
	// pauses here exactly as it does on the entry that owes no formatter pass.
	expect(mockRunFormatter).toHaveBeenCalledTimes(1);
	expect(stopped()?.status).toBe(RunStatus.PausedRateLimit);
	expect(parked?.ok).toBe(false);
	expect(mockRunVerificationGates).not.toHaveBeenCalled();
	expect(roleInvocations).toStrictEqual([]);
	// the formatter pass is not owed again on the resume that follows: it ran,
	// and the park is about the reviewer rather than the tree
	expect(manifest.steps[0]?.verification?.needsFormatting).toBe(false);
});

test('verifyStep: the reviewer is told which checkpoint it is judging, and is handed the plan and the overview', async () => {
	const { run, buildFix } = setupFormattingReentry();
	// the one thing this case varies: a reviewer that ruled rather than one the
	// harness throttled, so the checkpoint runs its whole sequence
	mockReviewTestChanges.mockResolvedValue({});

	await verifyStep({ run, planContent: '# Plan', overviewContent: '# Overview', id: checkpoint, acceptanceTests: () => [], buildFix })();

	// The reviewer rules on whether a change to a test is one the plan's own work
	// makes necessary, so the plan is the whole standard it judges against — and
	// on a phased run the overview is where the surrounding phases are stated. A
	// checkpoint that dropped either would hand the judge a change with nothing
	// to judge it by, and the checkpoint id is how the journal line and the usage
	// row say which verification asked.
	expect(mockReviewTestChanges).toHaveBeenCalledWith(expect.objectContaining({ checkpoint, planContent: '# Plan', overviewContent: '# Overview' }));
	expect(mockRunVerificationGates).toHaveBeenCalledTimes(1);
});

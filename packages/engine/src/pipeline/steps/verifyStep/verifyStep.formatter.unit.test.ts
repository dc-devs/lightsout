import { describe, expect, jest, test } from '@jest/globals';
import type { AcceptanceRow } from '#src/common/types/AcceptanceRow.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/index.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';

// Mocked Imports
// -------------------------
// The formatter is the collaborator under examination here, so what it answers
// is chosen per pass; it has its own suite for how it settles a tree.
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
// The review and the gates are what these tests assert do NOT run on a tree the
// formatter could not settle, so both are recorders that hand back a verdict.
interface ReviewParams {
	run: PipelineRun;
	checkpoint: string;
	planContent: string;
	overviewContent?: string;
}

const mockReviewTestChanges = jest.fn<(params: ReviewParams) => Promise<{ error?: string; rateLimited?: boolean }>>();

jest.mock('#src/pipeline/approvedTests/index.ts', () => ({
	reviewTestChanges: (params: ReviewParams) => mockReviewTestChanges(params),
	// The rest of the module is what the post-gate snapshot approval reaches
	// for. It has its own test; here it must simply do nothing.
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
// The last stage of the repair budget. It is stubbed so these tests end where
// the budget ends rather than in a real agent spawn; what the supervisor rules
// is the supervisor's own test.
const mockConsultSupervisor = jest.fn<() => Promise<{ ok: false; rateLimited: boolean; error: string }>>();

jest.mock('#src/common/utils/consultSupervisor.ts', () => ({
	consultSupervisor: () => mockConsultSupervisor(),
}));
// -------------------------

const checkpoint = 'verify-implement';

const greenGates: VerificationResult = { error: undefined, failedFamilies: [], crashes: [], coordination: undefined, failures: [], gates: [] };

interface SetupParams {
	/** What each formatter pass answers, in order; the last entry is repeated once the list is spent. */
	formatterAnswers?: (string | undefined)[];
}

/**
 * A checkpoint that owes a formatter pass — the state every repair attempt
 * re-enters by — over a `PipelineRun` stub whose stops are captured rather than
 * thrown, whose fix-role turns are recorded with the error they were handed,
 * and whose driver throws, so an agent these tests say is never spawned is loud
 * rather than silent if it is.
 */
const setupFormatterRun = ({ formatterAnswers = [undefined] }: SetupParams = {}) => {
	let formatterCall = 0;

	mockRunFormatter.mockImplementation(async () => {
		const answer = formatterAnswers[Math.min(formatterCall, formatterAnswers.length - 1)];
		formatterCall += 1;

		return answer;
	});
	mockReviewTestChanges.mockResolvedValue({});
	mockRunVerificationGates.mockResolvedValue(greenGates);
	mockConsultSupervisor.mockResolvedValue({ ok: false, rateLimited: false, error: 'the supervisor is not what these tests are about' });

	const owedFormatting = { failedFamilies: [], repairAttempts: {}, failures: [], needsFormatting: true, guidedRepairAttempted: false };
	const steps: StepRecord[] = [{ id: checkpoint, status: RunStatus.Running, attempts: 1, verification: owedFormatting }];
	const manifest = { runId: 'run-1', steps, changedFiles: [], packages: [], acceptanceTests: [], approvedTests: [] } as unknown as RunManifest;
	const fixErrorContexts: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;

	const run = {
		cwd: '/tmp/lightsout-verify-step-formatter',
		config: {} as unknown as LightsoutConfig,
		driver: createUncalledDriver({ reason: 'the checkpoint reaches its agents through invokeRole and the supervisor, both stubbed here' }),
		current: () => manifest,
		progress: () => {},
		parkMessage: () => 'run parked: harness rate limited',
		nextRecord: ({ id }: { id: string }) => ({ id, status: RunStatus.Running, attempts: 1 }),
		setStep: async ({ record }: { record: StepRecord }) => {
			manifest.steps = [record];
		},
		update: async () => {},
		stop: async ({ status, error }: { status: RunStatus; error: string }) => {
			stopped = { status, error };

			return { ok: false as const, manifest, error };
		},
		invokeRole: async () => ({ ok: false as const, rateLimited: false, error: 'the fix role does not settle this tree' }),
		agentEventSink: () => () => {},
		persistRejected: () => async () => {},
		recordUsage: async () => {},
	};

	const buildFix = ({ errorContext }: { errorContext: string }) => {
		fixErrorContexts.push(errorContext);

		return { systemPrompt: 'repair the checkpoint', prompt: errorContext };
	};

	return { run: run as unknown as PipelineRun, manifest, buildFix, fixErrorContexts, stopped: () => stopped };
};

describe('verifyStep', () => {
	test('verifyStep: a formatter that fails is the verdict, and nothing is judged or gated on the tree it could not settle', async () => {
		const formatError = 'prettier exited 2: packages/engine/src/gates/runGates.ts — unterminated string literal';
		const { run, manifest, buildFix, stopped } = setupFormatterRun({ formatterAnswers: [formatError] });

		const escalation = await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => [], buildFix })();

		// A tree the formatter could not settle is not a tree anything else may
		// read: a review would judge diffs the formatter was about to rewrite, and
		// a gate would prove something about bytes that are not the ones the run
		// leaves behind. So the formatter's own text is the checkpoint's red, under
		// the `format` family, with no review and no gate spent.
		expect(mockReviewTestChanges).not.toHaveBeenCalled();
		expect(mockRunVerificationGates).not.toHaveBeenCalled();
		expect(manifest.steps[0]?.verification?.failedFamilies).toStrictEqual(['format']);
		expect(stopped()?.status).toBe(RunStatus.Escalated);
		expect(escalation?.error).toEqual(expect.stringContaining(formatError));
	});

	test("verifyStep: the formatter's own error is what the checkpoint's fix role is handed to repair", async () => {
		const formatError = 'biome exited 1: packages/engine/src/gates/runGates.ts — expected `)` but found `;`';
		const { run, buildFix, fixErrorContexts } = setupFormatterRun({ formatterAnswers: [formatError] });

		await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => [], buildFix })();

		// A format red rides the repair budget the checkpoint already has, and each
		// mechanical turn is handed the formatter's own complaint — an agent given
		// anything else would be repairing a failure it cannot see.
		expect(fixErrorContexts).toStrictEqual([formatError, formatError]);
	});

	test('verifyStep: a format red the fix role clears lets the review and the gates run on the settled tree', async () => {
		const formatError = 'prettier exited 2: packages/engine/src/gates/runGates.ts — unterminated string literal';
		const { run, buildFix } = setupFormatterRun({ formatterAnswers: [formatError, undefined] });

		const escalation = await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => [], buildFix })();

		// The format family is repairable like any other, so a red that clears on
		// the re-entry carries on into the review and the gates rather than ending
		// the checkpoint — and the gates run exactly once, on the settled tree,
		// never on the one the first pass rejected.
		expect(mockRunFormatter).toHaveBeenCalledTimes(2);
		expect(mockReviewTestChanges).toHaveBeenCalledTimes(1);
		expect(mockRunVerificationGates).toHaveBeenCalledTimes(1);
		expect(escalation).toBeUndefined();
	});
});

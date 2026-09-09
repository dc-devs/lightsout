import { describe, expect, jest, test } from '@jest/globals';
import type { AcceptanceRow } from '#src/common/types/AcceptanceRow.ts';
import { type AcceptanceTestRecord, type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/index.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';

// Mocked Imports
// -------------------------
// What a checkpoint DOES — format the tree, judge the test-side changes, run
// the gates — is three collaborators with three test suites of their own. What
// is under test here is the order it does them in and what it does with each
// answer, so each one is replaced by a recorder that appends its own name to a
// shared list and hands back a verdict the test chose.
const calls: string[] = [];

interface ReviewOutcome {
	error?: string;
	rateLimited?: boolean;
}

interface ReviewParams {
	run: PipelineRun;
	checkpoint: string;
	planContent: string;
	overviewContent?: string;
}

const mockReviewTestChanges = jest.fn<(params: ReviewParams) => Promise<ReviewOutcome>>();

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
// The last stage of the repair budget. It is stubbed so these tests end where
// the budget ends rather than in a real agent spawn; what the supervisor rules
// is the supervisor's own test.
const mockConsultSupervisor = jest.fn<() => Promise<{ ok: false; rateLimited: boolean; error: string }>>();

jest.mock('#src/common/utils/consultSupervisor.ts', () => ({
	consultSupervisor: () => mockConsultSupervisor(),
}));
// -------------------------

const checkpoint = 'verify-implement';

/** A gate run that came back green, and one that came back red under the unit-test family. */
const greenGates: VerificationResult = { error: undefined, failedFamilies: [], crashes: [], coordination: undefined, failures: [], gates: [] };
const redGates: VerificationResult = { error: 'unit tests failed', failedFamilies: ['test'], crashes: [], coordination: undefined, failures: [], gates: [] };

interface SetupParams {
	/** What the reviewer answers, one entry per checkpoint entry; the last is repeated once the list is spent. */
	reviews?: ReviewOutcome[];
	/** What the gates answer, one entry per gate run; the last is repeated once the list is spent. */
	gates?: VerificationResult[];
	/** Seed the checkpoint so it re-enters through the formatter, the way a repair attempt does. */
	needsFormatting?: boolean;
	/** The manifest's live acceptance-test mapping. */
	acceptanceTests?: AcceptanceTestRecord[];
	/** Runs when the checkpoint's fix role is invoked — where a test rewrites the manifest between two verifications. */
	onFixRole?: (params: { manifest: RunManifest }) => void;
}

/**
 * A PipelineRun stub carrying only what a verification checkpoint touches:
 * every stop is captured rather than thrown, every fix-role turn is recorded
 * with the error it was handed, and the driver throws — so an agent these
 * tests say is never spawned is loud rather than silent if it is.
 */
const setupTestReviewRun = ({ reviews = [{}], gates = [greenGates], needsFormatting = false, acceptanceTests = [], onFixRole }: SetupParams = {}) => {
	calls.length = 0;

	let reviewCall = 0;
	let gateCall = 0;

	mockRunFormatter.mockImplementation(async () => {
		calls.push('formatter');

		return undefined;
	});
	mockReviewTestChanges.mockImplementation(async () => {
		calls.push('review');

		const outcome = reviews[Math.min(reviewCall, reviews.length - 1)] ?? {};
		reviewCall += 1;

		return outcome;
	});
	mockRunVerificationGates.mockImplementation(async () => {
		calls.push('gates');

		const verdict = gates[Math.min(gateCall, gates.length - 1)] ?? greenGates;
		gateCall += 1;

		return verdict;
	});
	mockConsultSupervisor.mockResolvedValue({ ok: false, rateLimited: false, error: 'the supervisor is not what these tests are about' });

	const seededVerification = { failedFamilies: [], repairAttempts: {}, failures: [], needsFormatting: true, guidedRepairAttempted: false };
	const steps: StepRecord[] = needsFormatting ? [{ id: checkpoint, status: RunStatus.Running, attempts: 1, verification: seededVerification }] : [];
	const manifest = { runId: 'run-1', steps, changedFiles: [], packages: [], acceptanceTests, approvedTests: [] } as unknown as RunManifest;

	const progress: string[] = [];
	const roleInvocations: string[] = [];
	const fixErrorContexts: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;

	const run = {
		cwd: '/tmp/lightsout-verify-step-test-review',
		config: {} as unknown as LightsoutConfig,
		driver: createUncalledDriver({ reason: 'the checkpoint reaches its agents through invokeRole and the reviewer, both stubbed here' }),
		current: () => manifest,
		progress: (message: string) => progress.push(message),
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
		invokeRole: async ({ step }: { step: string }) => {
			roleInvocations.push(step);
			onFixRole?.({ manifest });

			return { ok: false as const, rateLimited: false, error: 'the fix role does not clear this red' };
		},
		agentEventSink: () => () => {},
		persistRejected: () => async () => {},
		recordUsage: async () => {},
	};

	const buildFix = ({ errorContext }: { errorContext: string }) => {
		fixErrorContexts.push(errorContext);

		return { systemPrompt: 'repair the checkpoint', prompt: errorContext };
	};

	return { run: run as unknown as PipelineRun, manifest, buildFix, progress, roleInvocations, fixErrorContexts, stopped: () => stopped };
};

describe('verifyStep', () => {
	test('verifyStep: the test-change review runs after the formatter and before the first gate', async () => {
		const { run, buildFix } = setupTestReviewRun({ needsFormatting: true });

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			overviewContent: '# Overview',
			id: checkpoint,
			acceptanceTests: () => [],
			final: false,
			buildFix,
		})();

		// The order is the whole guarantee. A weakened test judged AFTER its gate
		// ran would already have made that gate prove the wrong thing, and a
		// review judged before the formatter would read diffs the formatter is
		// about to rewrite.
		expect(calls).toStrictEqual(['formatter', 'review', 'gates']);
		expect(escalation).toBeUndefined();
	});

	test('verifyStep: a refused review goes red under the review family and no gate command runs', async () => {
		const refusal = [
			'the test-change review refused this checkpoint’s changes; no gate ran.',
			'- packages/engine/src/gates/runGates.unit.test.ts: the assertion on the failed family was deleted, and the plan authorises no such change',
		].join('\n');
		const { run, buildFix, manifest } = setupTestReviewRun({ reviews: [{ error: refusal }] });

		const escalation = await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => [], buildFix })();

		// A refusal has to stop the checkpoint before the gates, not alongside
		// them: the gates are exactly what a weakened test would have talked
		// around.
		expect(mockRunVerificationGates).not.toHaveBeenCalled();
		expect(manifest.steps[0]?.verification?.failedFamilies).toStrictEqual(['test-review']);
		expect(escalation?.error).toEqual(expect.stringContaining(refusal));
	});

	test("verifyStep: a refused review is handed to the checkpoint's fix role under the existing repair budget", async () => {
		const refusal =
			'the test-change review refused this checkpoint’s changes; no gate ran.\n- packages/engine/src/gates/runGates.unit.test.ts: the mock neuters the subject';
		const { run, buildFix, roleInvocations, fixErrorContexts } = setupTestReviewRun({ reviews: [{ error: refusal }] });

		await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => [], buildFix })();

		// Two mechanical turns of the checkpoint's own fix role and no more: the
		// review rides the repair budget the checkpoint already has, rather than
		// opening a retry loop of its own. Each turn is handed the refusal itself,
		// so the repairing agent reads what the reviewer objected to.
		expect(roleInvocations).toStrictEqual([checkpoint, checkpoint]);
		expect(fixErrorContexts).toStrictEqual([refusal, refusal]);
	});

	test('verifyStep: a rate-limited reviewer parks the run', async () => {
		const { run, buildFix, roleInvocations, stopped } = setupTestReviewRun({ reviews: [{ rateLimited: true }] });

		const parked = await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => [], buildFix })();

		// A reviewer the harness throttled said nothing about the tests. There is
		// no verdict to repair and no failure to escalate, so the run pauses and a
		// resume asks again.
		expect(stopped()?.status).toBe(RunStatus.PausedRateLimit);
		expect(parked?.ok).toBe(false);
		expect(roleInvocations).toStrictEqual([]);
		expect(mockRunVerificationGates).not.toHaveBeenCalled();
	});

	test('verifyStep: the acceptance mapping is read from the manifest at every verification, not once at build time', async () => {
		const before: AcceptanceTestRecord = {
			criterion: 'A rejection returns an error naming each rejected file',
			testFile: 'packages/engine/src/pipeline/approvedTests/reviewTestChanges.unit.test.ts',
			testName: 'reviewTestChanges: a rejection names every refused file and leaves the manifest baseline untouched',
			gate: 'test',
		};
		const renamed: AcceptanceTestRecord = { ...before, testName: 'reviewTestChanges: a refusal names every refused file and leaves the baseline untouched' };
		const { run, manifest, buildFix } = setupTestReviewRun({
			gates: [redGates, greenGates],
			acceptanceTests: [before],
			// Stands in for a disposition the reviewer approves at this very
			// checkpoint: the row it names now carries a different test name.
			onFixRole: ({ manifest: live }) => {
				live.acceptanceTests = [renamed];
			},
		});

		await verifyStep({ run, planContent: '# Plan', id: checkpoint, acceptanceTests: () => manifest.acceptanceTests, buildFix })();

		// The second verification has to prove the name the mapping carries NOW.
		// A list read once when the steps were built would hand the same stale row
		// to both gate runs, and the renamed test would be reported missing.
		expect(mockRunVerificationGates.mock.calls.map(([params]) => params.rows)).toStrictEqual([[before], [renamed]]);
	});
});

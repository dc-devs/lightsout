import { expect, jest, test } from '@jest/globals';
import type { AcceptanceTestRecord, GateResult, RunManifest } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { reviewAndVerify } from '#src/pipeline/steps/verify/reviewAndVerify.ts';

// Mocked Imports
// -------------------------
// The review has its own tests and its own verdict rules. What is under test
// here is only what the checkpoint does with the answer, so the call is
// captured and the answer is handed back directly.
interface ReviewParams {
	run: PipelineRun;
	checkpoint: string;
	planContent: string;
	overviewContent?: string;
}

const mockReviewTestChanges = jest.fn<(params: ReviewParams) => Promise<{ error?: string; rateLimited?: boolean }>>();

jest.mock('#src/pipeline/approvedTests/index.ts', () => ({
	reviewTestChanges: (params: ReviewParams) => mockReviewTestChanges(params),
}));
// -------------------------
interface GateParams {
	run: PipelineRun;
	coverage?: boolean;
	checkpoint: string;
	rows: { testFile: string; testName: string; gate: string }[];
	final?: boolean;
}

type GateOutcome = GateRunResult & { failures: GateResult[]; gates: GateResult[] };

const mockRunVerificationGates = jest.fn<(params: GateParams) => Promise<GateOutcome>>();

jest.mock('#src/pipeline/common/utils/runVerificationGates.ts', () => ({
	runVerificationGates: (params: GateParams) => mockRunVerificationGates(params),
}));
// -------------------------
const mockApproveRunnerSnapshots = jest.fn<(params: { run: PipelineRun }) => Promise<number>>();

jest.mock('#src/pipeline/steps/verify/approveRunnerSnapshots.ts', () => ({
	approveRunnerSnapshots: (params: { run: PipelineRun }) => mockApproveRunnerSnapshots(params),
}));
// -------------------------

const greenGates: GateOutcome = { error: undefined, failedFamilies: [], crashes: [], coordination: undefined, failures: [], gates: [] };

/**
 * One verification checkpoint's collaborators, with the acceptance mapping held
 * behind a setter rather than captured in the parameters: the mapping is read
 * through a closure at every entry into the gates, so a row a disposition
 * renamed during this very checkpoint is proven under the name it now carries.
 */
const setupCheckpoint = ({ review = {} }: { review?: { error?: string; rateLimited?: boolean } } = {}) => {
	mockReviewTestChanges.mockResolvedValue(review);
	mockRunVerificationGates.mockResolvedValue(greenGates);
	mockApproveRunnerSnapshots.mockResolvedValue(0);

	const manifest = { runId: 'run-1', steps: [], changedFiles: [], packages: [] } as unknown as RunManifest;
	const run = {
		cwd: '/tmp/lightsout-review-and-verify',
		current: () => manifest,
		progress: () => {},
	} as unknown as PipelineRun;

	let liveRows: AcceptanceTestRecord[] = [];
	const setLiveRows = (rows: AcceptanceTestRecord[]) => {
		liveRows = rows;
	};

	return { run, acceptanceTests: () => liveRows, setLiveRows };
};

test('reviewAndVerify: a refused review returns the review family with no gate run, and a clean review runs the gates with the live mapping', async () => {
	const refused = setupCheckpoint({
		review: { error: 'test-change review refused this checkpoint: packages/engine/src/widget.unit.test.ts — the assertion was weakened' },
	});

	const refusal = await reviewAndVerify({
		run: refused.run,
		id: 'verify-tests',
		coverage: true,
		final: false,
		planContent: '# Plan',
		overviewContent: '# Overview',
		acceptanceTests: refused.acceptanceTests,
	});

	// A weakened or approved-away test makes a gate prove the wrong thing, so the
	// refusal has to land before any gate command runs — the checkpoint goes red
	// under its own family with the gates untouched, which is the shape a format
	// failure already takes and the shape the fix role already repairs.
	expect(refusal).toStrictEqual({
		error: 'test-change review refused this checkpoint: packages/engine/src/widget.unit.test.ts — the assertion was weakened',
		failedFamilies: ['test-review'],
		crashes: [],
		coordination: undefined,
		failures: [],
	});
	expect(mockRunVerificationGates).not.toHaveBeenCalled();

	const clean = setupCheckpoint();
	const renamedRows: AcceptanceTestRecord[] = [
		{
			criterion: 'A refused review goes red without running a gate',
			testFile: 'packages/engine/src/pipeline/steps/verify/reviewAndVerify.unit.test.ts',
			testName: 'reviewAndVerify: the renamed title the disposition just recorded',
			gate: 'test',
		},
	];
	clean.setLiveRows(renamedRows);

	const verified = await reviewAndVerify({
		run: clean.run,
		id: 'verify-refactor',
		coverage: true,
		final: true,
		planContent: '# Plan',
		overviewContent: '# Overview',
		acceptanceTests: clean.acceptanceTests,
	});

	// The rows reach the gate run resolved at call time, so the mapping proved is
	// the manifest's live one rather than the plan's original list, and the gates'
	// own verdict is what the checkpoint returns.
	expect(mockRunVerificationGates).toHaveBeenCalledWith(
		expect.objectContaining({ checkpoint: 'verify-refactor', coverage: true, final: true, rows: renamedRows }),
	);
	expect(verified).toStrictEqual(greenGates);
});

test('reviewAndVerify: a refused review carries no coordination reason', async () => {
	const { run, acceptanceTests } = setupCheckpoint({
		review: { error: 'test-change review refused this checkpoint: packages/engine/src/widget.unit.test.ts — the assertion was weakened' },
	});

	const refusal = await reviewAndVerify({
		run,
		id: 'verify-tests',
		coverage: true,
		final: false,
		planContent: '# Plan',
		overviewContent: '# Overview',
		acceptanceTests,
	});

	// The review is judgment about the diff, reached before any gate is spent, so
	// the machine was never asked for and nothing about it is in question. The
	// coordination channel stays empty, which is what keeps the refusal an
	// ordinary red the checkpoint's fix role repairs under its existing budget
	// rather than a reason to end the run.
	expect(refusal).toEqual(
		expect.objectContaining({
			error: expect.stringContaining('the assertion was weakened'),
			failedFamilies: ['test-review'],
			coordination: undefined,
		}),
	);
	expect(mockRunVerificationGates).not.toHaveBeenCalled();
});

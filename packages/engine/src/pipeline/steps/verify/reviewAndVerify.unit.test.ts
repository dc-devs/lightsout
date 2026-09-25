import { expect, jest, test } from '@jest/globals';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import type { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';
import type { AcceptanceTestRecord } from '#src/contracts/run/AcceptanceTestRecord.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
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
// The rename check has its own tests against a real repository. Here it is only
// the judgment a rename-only checkpoint asks in place of the review.
interface RenameCheckParams {
	run: PipelineRun;
	checkpoint: string;
	renames: RenameRule[];
}

const mockCheckRenameOnlyChanges = jest.fn<(params: RenameCheckParams) => Promise<{ error?: string }>>();

jest.mock('#src/pipeline/renameCheck/index.ts', () => ({
	checkRenameOnlyChanges: (params: RenameCheckParams) => mockCheckRenameOnlyChanges(params),
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

const greenGates: GateOutcome = { error: undefined, failedFamilies: [], crashes: [], timeouts: [], coordination: undefined, failures: [], gates: [] };

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
		renames: [],
	});

	// A weakened or approved-away test makes a gate prove the wrong thing, so the
	// refusal has to land before any gate command runs — the checkpoint goes red
	// under its own family with the gates untouched, which is the shape a format
	// failure already takes and the shape the fix role already repairs.
	expect(refusal).toStrictEqual({
		error: 'test-change review refused this checkpoint: packages/engine/src/widget.unit.test.ts — the assertion was weakened',
		failedFamilies: ['test-review'],
		crashes: [],
		timeouts: [],
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
		renames: [],
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
		renames: [],
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

const renames: RenameRule[] = [{ from: 'widgetName', to: 'gadgetName', line: 12 }];

/**
 * One checkpoint of a rename-only plan: the rename check answers where the
 * review would, and the review is wired to pass so that a call reaching it is
 * visible only as a call, never as a changed verdict.
 */
const setupRenameCheckpoint = ({ renameCheck = {} }: { renameCheck?: { error?: string } } = {}) => {
	mockCheckRenameOnlyChanges.mockResolvedValue(renameCheck);
	mockReviewTestChanges.mockResolvedValue({});
	mockRunVerificationGates.mockResolvedValue(greenGates);
	mockApproveRunnerSnapshots.mockResolvedValue(0);

	const manifest = { runId: 'run-1', steps: [], changedFiles: [], packages: [] } as unknown as RunManifest;
	const run = {
		cwd: '/tmp/lightsout-review-and-verify',
		current: () => manifest,
		progress: () => {},
	} as unknown as PipelineRun;

	return { run, acceptanceTests: () => [] };
};

test('reviewAndVerify: a rename-only checkpoint refused by the rename check goes red under rename-check with no review and no gate', async () => {
	const { run, acceptanceTests } = setupRenameCheckpoint({
		renameCheck: { error: 'rename check refused this checkpoint and no gate ran: packages/engine/src/widget.ts added 3 ×1, removed 2 ×1' },
	});

	const refusal = await reviewAndVerify({
		run,
		id: 'verify-implement',
		coverage: false,
		final: false,
		planContent: '# Plan',
		overviewContent: '# Overview',
		acceptanceTests,
		renames,
	});

	// A change the renames do not explain is refused before any gate is spent,
	// in the same shape a refused review takes, so the checkpoint's fix role
	// repairs it under the budget it already has.
	expect({
		refusal,
		reviewCalls: mockReviewTestChanges.mock.calls.length,
		gateCalls: mockRunVerificationGates.mock.calls.length,
	}).toStrictEqual({
		refusal: {
			error: 'rename check refused this checkpoint and no gate ran: packages/engine/src/widget.ts added 3 ×1, removed 2 ×1',
			failedFamilies: ['rename-check'],
			crashes: [],
			timeouts: [],
			coordination: undefined,
			failures: [],
		},
		reviewCalls: 0,
		gateCalls: 0,
	});
});

test('reviewAndVerify: a rename-only checkpoint runs the rename check in place of the test-change review, and any other runs the review', async () => {
	const renameOnly = setupRenameCheckpoint();

	const renameOnlyResult = await reviewAndVerify({
		run: renameOnly.run,
		id: 'verify-tests',
		coverage: true,
		final: true,
		planContent: '# Plan',
		overviewContent: '# Overview',
		acceptanceTests: renameOnly.acceptanceTests,
		renames,
	});

	// A passing rename check hands over to every gate, coverage included, and
	// no agent is asked to read the rename's test edits.
	expect({
		result: renameOnlyResult,
		renameCheckCalls: mockCheckRenameOnlyChanges.mock.calls,
		reviewCalls: mockReviewTestChanges.mock.calls.length,
		gateCalls: mockRunVerificationGates.mock.calls.length,
	}).toStrictEqual({
		result: greenGates,
		renameCheckCalls: [[{ run: renameOnly.run, checkpoint: 'verify-tests', renames }]],
		reviewCalls: 0,
		gateCalls: 1,
	});

	const other = setupRenameCheckpoint();

	const otherResult = await reviewAndVerify({
		run: other.run,
		id: 'verify-tests',
		coverage: true,
		final: true,
		planContent: '# Plan',
		overviewContent: '# Overview',
		acceptanceTests: other.acceptanceTests,
		renames: [],
	});

	// Every plan with no renames is judged exactly as before: the review runs,
	// then the gates, and the rename check is never asked. The counts carry the
	// rename-only entry above, so the rename check still holds its one call and
	// the gates their second.
	expect({
		result: otherResult,
		renameCheckCalls: mockCheckRenameOnlyChanges.mock.calls.length,
		reviewCalls: mockReviewTestChanges.mock.calls,
		gateCalls: mockRunVerificationGates.mock.calls.length,
	}).toStrictEqual({
		result: greenGates,
		renameCheckCalls: 1,
		reviewCalls: [[{ run: other.run, checkpoint: 'verify-tests', planContent: '# Plan', overviewContent: '# Overview' }]],
		gateCalls: 2,
	});
});

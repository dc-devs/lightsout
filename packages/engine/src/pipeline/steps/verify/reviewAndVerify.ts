import type { AcceptanceTestRecord } from '#src/contracts/index.ts';
import { reviewTestChanges } from '#src/pipeline/approvedTests/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { approveRunnerSnapshots } from '#src/pipeline/steps/verify/approveRunnerSnapshots.ts';

interface Params {
	run: PipelineRun;
	/** The verification checkpoint in flight. */
	id: string;
	coverage?: boolean;
	/** True at the run's last verification. */
	final?: boolean;
	planContent: string;
	overviewContent?: string;
	/** The live acceptance-test mapping, read afresh at every call. */
	acceptanceTests: () => AcceptanceTestRecord[];
}

/**
 * One entry into a checkpoint's verification: judge the test-side changes, then
 * run the gates.
 *
 * The order is the guarantee. An approved-away or weakened test makes a gate
 * prove the wrong thing, so the judgment has to land before the gate runs — and
 * a refusal is the checkpoint's verdict on its own, under the `test-review`
 * family, with no gate spent. That is the same shape a format failure already
 * takes, so the checkpoint's own fix role repairs it under the repair budget it
 * already has. The working tree is never restored.
 *
 * The mapping arrives as a function rather than a list because a disposition the
 * reviewer approves at this very checkpoint rewrites it: the rows proved are the
 * ones the manifest carries now, not the ones the plan first wrote down.
 *
 * @returns `{ rateLimited: true }` when the reviewer was rate limited and the caller must park; otherwise the checkpoint's verification result.
 */
export const reviewAndVerify = async ({
	run,
	id,
	coverage,
	final,
	planContent,
	overviewContent,
	acceptanceTests,
}: Params): Promise<{ rateLimited: true } | VerificationResult> => {
	const review = await reviewTestChanges({ run, checkpoint: id, planContent, overviewContent });

	if (review.rateLimited) {
		return { rateLimited: true };
	}

	if (review.error !== undefined) {
		return { error: review.error, failedFamilies: ['test-review'], crashes: [], coordination: undefined, failures: [] };
	}

	const result = await runVerificationGates({ run, coverage, checkpoint: id, rows: acceptanceTests(), final });

	// Whatever the verdict: jest writes a brand-new snapshot itself during the
	// gate run, and the runner's own output must not arrive at the next
	// checkpoint as somebody's edit to a test.
	await approveRunnerSnapshots({ run });

	return result;
};

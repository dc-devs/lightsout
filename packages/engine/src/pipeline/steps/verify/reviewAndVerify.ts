import type { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';
import type { AcceptanceTestRecord } from '#src/contracts/run/AcceptanceTestRecord.ts';
import { reviewTestChanges } from '#src/pipeline/approvedTests/reviewTestChanges.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { checkRenameOnlyChanges } from '#src/pipeline/renameCheck/checkRenameOnlyChanges.ts';
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
	/** The plan's declared renames; non-empty only for a rename-only plan. */
	renames: RenameRule[];
}

/**
 * The judgment that lands before the gates: the rename check for a rename-only
 * plan, the test-change review for every other. Each refusal carries the family
 * the checkpoint goes red under.
 */
const judgeChanges = async ({
	run,
	id,
	planContent,
	overviewContent,
	renames,
}: {
	run: PipelineRun;
	id: string;
	planContent: string;
	overviewContent?: string;
	renames: RenameRule[];
}) => {
	let error: string | undefined;
	let family: string;
	let rateLimited = false;

	if (renames.length > 0) {
		({ error } = await checkRenameOnlyChanges({ run, checkpoint: id, renames }));
		family = 'rename-check';
	} else {
		const review = await reviewTestChanges({ run, checkpoint: id, planContent, overviewContent });

		error = review.error;
		family = 'test-review';
		rateLimited = review.rateLimited === true;
	}

	return { error, family, rateLimited };
};

/**
 * One entry into a checkpoint's verification: judge the changes, then run the
 * gates. The judgment is the rename check for a rename-only plan — every changed
 * file must differ from the phase's start only by the declared renames — and the
 * test-change review of the test-side changes for every other plan.
 *
 * The order is the guarantee. An approved-away or weakened test makes a gate
 * prove the wrong thing, so the judgment has to land before the gate runs — and
 * a refusal is the checkpoint's verdict on its own, under the `test-review`
 * family (or `rename-check`), with no gate spent. That is the same shape a
 * format failure already takes, so the checkpoint's own fix role repairs it
 * under the repair budget it already has. The working tree is never restored.
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
	renames,
}: Params): Promise<{ rateLimited: true } | VerificationResult> => {
	const judgment = await judgeChanges({ run, id, planContent, overviewContent, renames });

	if (judgment.rateLimited) {
		return { rateLimited: true };
	}

	if (judgment.error !== undefined) {
		return {
			error: judgment.error,
			failedFamilies: [judgment.family],
			crashes: [],
			timeouts: [],
			coordination: undefined,
			failures: [],
		};
	}

	const result = await runVerificationGates({ run, coverage, checkpoint: id, rows: acceptanceTests(), final });

	// Whatever the verdict: jest writes a brand-new snapshot itself during the
	// gate run, and the runner's own output must not arrive at the next
	// checkpoint as somebody's edit to a test.
	await approveRunnerSnapshots({ run });

	return result;
};

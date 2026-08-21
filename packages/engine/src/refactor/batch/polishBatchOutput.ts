import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { BatchOutcome, type RefactorBatch, type StandardsFinding } from '#src/contracts/index.ts';
import { SettleKind } from '#src/refactor/batch/common/constants/SettleKind.ts';
import { standaloneBanner } from '#src/refactor/batch/common/constants/standaloneBanner.ts';
import type { BatchTools } from '#src/refactor/batch/common/types/BatchTools.ts';
import { createFixInvoker } from '#src/refactor/batch/createFixInvoker.ts';
import { BatchStopKind } from '#src/refactor/common/constants/BatchStopKind.ts';
import type { BatchStop } from '#src/refactor/common/types/BatchStop.ts';

interface Params {
	tools: BatchTools;
	batch: RefactorBatch;
	/** The pre-edit advisories: the baseline the output review diffs against, and the list the executor already answered. */
	baseline: StandardsFinding[];
	/** The sites this batch just cleared — re-checked after the polish, so a polish that revives one cannot pass unnoticed. */
	workFindings: StandardsFinding[];
	standards?: string;
	testStandards?: string;
	onProgress: (message: string) => void;
}

/**
 * The batch's closing step: read the judgment rules against the code the batch
 * wrote, and spend one invocation on whatever that read turns up.
 *
 * Reached only once the gates are green and every site is gone, which is
 * exactly the moment the old loop declared victory. Green gates and cleared
 * sites say the batch satisfied its checks; they say nothing about the shape of
 * what replaced the old code, and a check that stands in for a judgment can be
 * satisfied by code the judgment would reject.
 *
 * The budget is one pass, deliberately. These are advisory findings, so nothing
 * here can fail the batch, and an unbounded review-fix-review loop would let a
 * judgment rule spend a run's whole budget arguing with itself.
 *
 * The sites are re-checked afterwards because the polish edits the same files
 * the batch just cleared: a polish that trades a shape problem for the blocking
 * finding the batch came to burn down is a decline, not a pass.
 */
export const polishBatchOutput = async ({ tools, batch, baseline, workFindings, standards, testStandards, onProgress }: Params): Promise<BatchStop> => {
	const resolve = () => tools.finish({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] });
	const introduced = await tools.reviewOutput({ baseline });

	if (introduced.length === 0) {
		return resolve();
	}

	const files = [...new Set(introduced.flatMap((finding) => finding.files.map((file) => file.path)))];

	onProgress(`${batch.id}: the review of what this batch wrote raised ${introduced.length} new advisory(s) — spending one polish pass`);

	await tools.invoke({
		label: 'polish',
		invocation: buildRefactorExecutorInvocation({
			planContent: standaloneBanner,
			changedFiles: files,
			standards,
			advisories: introduced,
			reportAdvisoryOutcomes: true,
		}),
	});

	const settled = await tools.settle({ invokeFix: createFixInvoker({ tools, files, workFindings, advisories: introduced, standards, testStandards }) });

	if (settled.kind === SettleKind.Parked) {
		return { kind: BatchStopKind.Parked };
	}

	if (settled.kind === SettleKind.Escalated) {
		return { kind: BatchStopKind.Escalated, error: settled.error };
	}

	const revived = await tools.remainingSiteKeys({ frozen: workFindings });

	if (revived.length === 0) {
		return resolve();
	}

	onProgress(`${batch.id}: the polish pass brought back ${revived.length} site(s) this batch had cleared — recorded as declined`);

	return tools.finish({ outcome: BatchOutcome.Declined, remainingSiteKeys: revived });
};

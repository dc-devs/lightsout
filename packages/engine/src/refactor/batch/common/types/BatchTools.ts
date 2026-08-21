import type { StandardsFinding } from '#src/contracts/index.ts';
import type { runBatchGates } from '#src/pipeline/index.ts';
import type { BatchRecorder } from '#src/refactor/batch/common/types/BatchRecorder.ts';
import type { BatchSiteChecker } from '#src/refactor/batch/common/types/BatchSiteChecker.ts';
import type { invokeBatchAgent } from '#src/refactor/batch/invokeBatchAgent.ts';
import type { reviewBatchOutput } from '#src/refactor/batch/reviewBatchOutput.ts';
import type { settleBatchGates } from '#src/refactor/batch/settleBatchGates.ts';

/**
 * Everything a batch's passes do to the world, bound to the one batch they act
 * on. The members that wrap a step borrow that step's own return type rather
 * than restating it, so a change to what a step answers cannot leave this
 * describing the old shape.
 */
export interface BatchTools {
	/** Spend one invocation on the batch, counting it against the attempt budget. */
	invoke: (params: { label: string; invocation: { systemPrompt: string; prompt: string } }) => ReturnType<typeof invokeBatchAgent>;
	/** The batch's report as it stands, without ending the batch. */
	reportOf: BatchRecorder['reportOf'];
	/** End the batch, merging git truth into the files it claims. */
	finish: BatchRecorder['finish'];
	/** Run the batch's gates, coverage included. */
	gates: () => ReturnType<typeof runBatchGates>;
	/** Ask the tree what it currently finds, without persisting a report. */
	checkLive: BatchSiteChecker['checkLive'];
	/** Which of the frozen sites the tree still shows. */
	remainingSiteKeys: BatchSiteChecker['remainingSiteKeys'];
	/** Read the judgment rules against the code the batch wrote, reporting only what the pre-edit review did not. */
	reviewOutput: (params: { baseline: StandardsFinding[] }) => ReturnType<typeof reviewBatchOutput>;
	/** Drive the gates to green, or to a parked or escalated end. */
	settle: (params: { invokeFix: Parameters<typeof settleBatchGates>[0]['invokeFix'] }) => ReturnType<typeof settleBatchGates>;
	/** What the passes have recorded about their own decisions, in order. */
	rationale: BatchRecorder['rationale'];
}

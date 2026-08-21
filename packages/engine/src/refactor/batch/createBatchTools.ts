import type { AgentUsage, LightsoutConfig, RefactorBatch, StandardsFinding } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatchGates } from '#src/pipeline/index.ts';
import { standaloneBanner } from '#src/refactor/batch/common/constants/standaloneBanner.ts';
import type { BatchTools } from '#src/refactor/batch/common/types/BatchTools.ts';
import { createBatchRecorder } from '#src/refactor/batch/createBatchRecorder.ts';
import { createSiteChecker } from '#src/refactor/batch/createSiteChecker.ts';
import { invokeBatchAgent } from '#src/refactor/batch/invokeBatchAgent.ts';
import { reviewBatchOutput } from '#src/refactor/batch/reviewBatchOutput.ts';
import { settleBatchGates } from '#src/refactor/batch/settleBatchGates.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batch: RefactorBatch;
	/** The run's standards packages — the judgment rules the output review reads. */
	packages: LoadedStandardsPackage[];
	/** Active framework channels, resolved once by the pipeline. */
	channels: string[];
	/** false skips the review of what the batch wrote — code-checks-only mode. */
	agentReview: boolean;
	/** Check scope of the run's worklist, threaded into the per-batch re-check. */
	checkPath?: string;
	/** Include baselined findings in re-checks — must match the worklist's mode. */
	checkAll: boolean;
	agentTimeoutMs: number;
	/** Files earlier steps already attributed — excluded from this batch's git-truth merge. */
	attributedFiles: string[];
	onProgress: (message: string) => void;
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
}

/**
 * Everything a batch's passes do to the world, bound to the one batch they act
 * on: spending an invocation, running the gates, asking the tree which of the
 * batch's sites are still live, and reporting an outcome.
 *
 * They are created together rather than passed around as loose arguments
 * because they share mutable batch-level state — the invocation count, the
 * rationale the passes accumulate, the files the agents claimed — and two
 * copies of that state could disagree about what the batch did.
 */
export const createBatchTools = ({
	cwd,
	runId,
	driver,
	config,
	batch,
	packages,
	channels,
	agentReview,
	checkPath,
	checkAll,
	agentTimeoutMs,
	attributedFiles,
	onProgress,
	recordUsage,
}: Params): BatchTools => {
	const { rationale, reportedFiles, advisoryOutcomes, reportOf, changedFiles, finish } = createBatchRecorder({ cwd, config, attributedFiles });
	const { checkLive, remainingSiteKeys } = createSiteChecker({ cwd, checkPath, checkAll });
	let invocationCount = 0;

	const invoke = ({ label, invocation }: { label: string; invocation: { systemPrompt: string; prompt: string } }) => {
		invocationCount += 1;

		return invokeBatchAgent({
			cwd,
			runId,
			driver,
			config,
			batch,
			invocation,
			label,
			invocationCount,
			agentTimeoutMs,
			reportedFiles,
			rationale,
			advisoryOutcomes,
			recordUsage,
		});
	};

	const reviewOutput = async ({ baseline }: { baseline: StandardsFinding[] }) =>
		reviewBatchOutput({
			cwd,
			runId,
			driver,
			batch,
			packages,
			channels,
			agentReview,
			baseline,
			changedFiles: await changedFiles(),
			timeoutMs: agentTimeoutMs,
			onProgress,
		});

	// Coverage stays on: a refactor must not drop coverage.
	const gates = () => runBatchGates({ cwd, config, coverage: true, runId, step: batch.id, onProgress });

	const settle = ({ invokeFix }: { invokeFix: Parameters<typeof settleBatchGates>[0]['invokeFix'] }) =>
		settleBatchGates({
			cwd,
			runId,
			driver,
			config,
			batchId: batch.id,
			planContent: standaloneBanner,
			attempts: invocationCount,
			onProgress,
			recordUsage,
			invokeFix,
			gates,
		});

	return { invoke, reportOf, finish, gates, checkLive, remainingSiteKeys, reviewOutput, settle, rationale };
};

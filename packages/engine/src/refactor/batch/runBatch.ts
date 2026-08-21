import { type AgentUsage, BatchOutcome, type LightsoutConfig, type RefactorBatch, type StandardsFinding } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { collectBatchAdvisories } from '#src/refactor/batch/collectBatchAdvisories.ts';
import { createBatchTools } from '#src/refactor/batch/createBatchTools.ts';
import { matchRemainingFindings } from '#src/refactor/batch/matchRemainingFindings.ts';
import { runBatchPass } from '#src/refactor/batch/runBatchPass.ts';
import { BatchStopKind } from '#src/refactor/common/constants/BatchStopKind.ts';
import type { BatchStop } from '#src/refactor/common/types/BatchStop.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batch: RefactorBatch;
	/** The run's standards packages, resolved once by the pipeline — the judgment rules the agent review reads come from here. */
	packages: LoadedStandardsPackage[];
	/** Active framework channels, resolved once by the pipeline. */
	channels: string[];
	/** Check scope of the run's worklist, threaded into the per-batch re-check. */
	checkPath?: string;
	/** Include baselined findings in re-checks — must match the worklist's mode. */
	checkAll: boolean;
	/** false skips both of this batch's agent reviews — the pre-edit read and the read of what it wrote. Code-checks-only mode. */
	agentReview: boolean;
	standards?: string;
	testStandards?: string;
	agentTimeoutMs: number;
	/** Files earlier steps already attributed — excluded from this batch's git-truth merge. */
	attributedFiles: string[];
	onProgress: (message: string) => void;
	/** Run-wide usage recorder (appends to agents.jsonl and totals). */
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
}

/**
 * Execute one batch to a terminal condition: invoke the refactor executor on
 * the batch's findings, verify with scoped gates (cheap fix retries route by
 * gate kind — a red COVERAGE gate goes to the test writer, everything else
 * back to the refactor executor), then re-check the batch's site keys.
 * Sites gone → the judgment rules are read against the code the batch WROTE
 * and one polish pass spent on anything new → resolved; agent changed nothing
 * and sites persist → declined; partial → one re-invocation on the remainder,
 * then whatever persists is declined with the agent's rationale attached.
 */
export const runBatch = async ({
	cwd,
	runId,
	driver,
	config,
	batch,
	packages,
	channels,
	checkPath,
	checkAll,
	agentReview,
	standards,
	testStandards,
	agentTimeoutMs,
	attributedFiles,
	onProgress,
	recordUsage,
}: Params): Promise<BatchStop> => {
	const tools = createBatchTools({
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
	});

	// One live check up front serves two purposes: the staleness check (earlier
	// batches may have already eliminated these sites — no agent spent) and
	// FRESH advisories (frozen worklist advisories cite pre-run line numbers).
	const preCheck = await tools.checkLive();
	const standingKeys = new Set(matchRemainingFindings({ frozen: batch.blocking, live: preCheck.findings }));

	if (standingKeys.size === 0) {
		onProgress(`${batch.id}: sites already resolved by earlier work — no agent spent`);

		return { kind: BatchStopKind.Done, report: tools.reportOf({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }), changedFiles: [] };
	}

	if (standingKeys.size < batch.blocking.length) {
		onProgress(
			`${batch.id}: ${batch.blocking.length - standingKeys.size} of ${batch.blocking.length} site(s) already resolved by earlier work — working the ${standingKeys.size} still standing`,
		);
	}

	const advisories = await collectBatchAdvisories({
		cwd,
		runId,
		driver,
		batch,
		packages,
		channels,
		findings: preCheck.findings,
		agentReview,
		timeoutMs: agentTimeoutMs,
		onProgress,
	});

	// Up to two executor passes: the initial batch, then one re-invocation on
	// whatever sites survived a pass that DID change the tree (a partial).
	const passBudget = 2;
	// The LIVE findings for the sites still standing, never the frozen ones. The
	// work-list is frozen when the run starts, so by the time a later batch is
	// reached an earlier one may have fixed a site while editing a file outside
	// its own scope — and the frozen copy also cites pre-run line numbers. Handed
	// the frozen list, an agent went looking for a finding that no longer existed
	// and reported the check as broken, which it was not.
	let workFindings: StandardsFinding[] = preCheck.findings.filter((finding) => standingKeys.has(finding.siteKey));
	let stop: BatchStop | undefined;

	for (let pass = 1; pass <= passBudget && stop === undefined; pass += 1) {
		const passed = await runBatchPass({ tools, batch, pass, workFindings, advisories, standards, testStandards, onProgress });

		if ('stop' in passed) {
			stop = passed.stop;
		} else {
			workFindings = passed.workFindings;
		}
	}

	// The budget ran out with sites still standing: a decline, and the only way
	// out of the loop that is not already a stop.
	return stop ?? (await tools.finish({ outcome: BatchOutcome.Declined, remainingSiteKeys: workFindings.map((finding) => finding.siteKey) }));
};

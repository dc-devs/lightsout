import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { BatchOutcome, type RefactorBatch, type StandardsFinding } from '#src/contracts/index.ts';
import { SettleKind } from '#src/refactor/batch/common/constants/SettleKind.ts';
import { standaloneBanner } from '#src/refactor/batch/common/constants/standaloneBanner.ts';
import type { BatchTools } from '#src/refactor/batch/common/types/BatchTools.ts';
import type { PassOutcome } from '#src/refactor/batch/common/types/PassOutcome.ts';
import { createFixInvoker } from '#src/refactor/batch/createFixInvoker.ts';
import { getAttemptStop } from '#src/refactor/batch/getAttemptStop.ts';
import { polishBatchOutput } from '#src/refactor/batch/polishBatchOutput.ts';
import { BatchStopKind } from '#src/refactor/common/constants/BatchStopKind.ts';

interface Params {
	tools: BatchTools;
	batch: RefactorBatch;
	/** 1 for the initial pass, 2 for the single requeue on whatever survived it. */
	pass: number;
	/** The findings this pass must resolve — the whole batch on pass 1, the survivors on the requeue. */
	workFindings: StandardsFinding[];
	advisories: StandardsFinding[];
	standards?: string;
	testStandards?: string;
	onProgress: (message: string) => void;
}

/**
 * One executor pass over the findings it was handed: invoke, verify with the
 * batch's gates, then re-check the sites.
 *
 * A terminal answer comes back as a stop. Sites that persist after a pass that
 * DID change the tree come back as the work a requeue should carry — the caller
 * decides whether there is a requeue left to spend.
 */
export const runBatchPass = async ({ tools, batch, pass, workFindings, advisories, standards, testStandards, onProgress }: Params): Promise<PassOutcome> => {
	const files = [...new Set(workFindings.flatMap((finding) => finding.files.map((file) => file.path)))];

	const attempt = await tools.invoke({
		label: pass === 1 ? '' : 'requeue',
		invocation: buildRefactorExecutorInvocation({
			scope: RefactorScope.Standalone,
			planContent: standaloneBanner,
			changedFiles: files,
			standards,
			findings: workFindings,
			advisories,
			reportAdvisoryOutcomes: true,
		}),
	});
	// Read before the pass is classified: past the classification the report
	// is known complete, but only the union's `ok` arm carries it.
	const changedNothing = attempt.ok && attempt.report.changedFiles.length === 0;
	const stop = await getAttemptStop({
		batchId: batch.id,
		attempt,
		workFindings,
		rationale: tools.rationale,
		onProgress,
		remainingSiteKeys: tools.remainingSiteKeys,
		gates: tools.gates,
		finish: tools.finish,
	});

	let outcome: PassOutcome | undefined = stop === undefined ? undefined : { stop };

	if (outcome === undefined) {
		// Verify — cheap mechanical retries with gate-kind routing, then the
		// supervisor's exception path if those are spent.
		const settled = await tools.settle({ invokeFix: createFixInvoker({ tools, files, workFindings, advisories, standards, testStandards }) });

		if (settled.kind === SettleKind.Parked) {
			outcome = { stop: { kind: BatchStopKind.Parked } };
		} else if (settled.kind === SettleKind.Escalated) {
			outcome = { stop: { kind: BatchStopKind.Escalated, error: settled.error } };
		} else {
			const remaining = await tools.remainingSiteKeys({ frozen: workFindings });

			if (remaining.length === 0) {
				// Every site cleared and the gates green — the old end of the batch.
				// Now the code this pass WROTE gets read against the judgment rules,
				// which nothing in the loop had done before.
				outcome = { stop: await polishBatchOutput({ tools, batch, baseline: advisories, workFindings, standards, testStandards, onProgress }) };
			} else if (changedNothing) {
				// A pass that changed nothing is a judged decline — record honestly and
				// move on; a decline never fails the run by itself.
				outcome = { stop: await tools.finish({ outcome: BatchOutcome.Declined, remainingSiteKeys: remaining }) };
			} else {
				// Survivors of a pass that DID change the tree. Whether another pass is
				// left to spend is the caller's budget to know, not this function's —
				// which is what keeps the loop's exhausted case reachable rather than
				// an impossibility asserted in a comment.
				onProgress(`${batch.id}: ${remaining.length} site(s) persist after a changing pass`);
				outcome = { workFindings: workFindings.filter((finding) => remaining.includes(finding.siteKey)) };
			}
		}
	}

	return outcome;
};

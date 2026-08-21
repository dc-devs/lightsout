import { type RefactorBatch, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatchReview } from '#src/refactor/batch/runBatchReview.ts';
import { findIntroducedFindings } from '#src/refactor/findIntroducedFindings.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/index.ts';

interface Params {
	cwd: string;
	/** Provenance for the judgment ledger — which run's review this was. */
	runId: string;
	driver: Driver;
	batch: RefactorBatch;
	/** The run's standards packages — the same judgment rules the pre-edit review read. */
	packages: LoadedStandardsPackage[];
	/** Active framework channels; a document out of play is not reviewed. */
	channels: string[];
	/** The pre-edit advisories, machine and agent alike: the baseline this diffs against. */
	baseline: StandardsFinding[];
	/** The files the batch's agents actually claimed — the only code this run can have written. */
	changedFiles: string[];
	/** false skips this read entirely — code-checks-only mode. */
	agentReview: boolean;
	timeoutMs: number;
	onProgress: (message: string) => void;
}

/**
 * A second read of the judgment rules, over the code the batch just wrote.
 *
 * The pre-edit review happens before the executor runs, so it can only judge
 * the code the batch inherited — nothing in the loop ever reads the output.
 * That is how a batch can satisfy every deterministic gate and still leave
 * worse code behind: hitting a line-count target by splitting a function into a
 * six-exit one passes the checks and fails the rule the check was standing in
 * for.
 *
 * What comes back is only what is NEW. An advisory the pre-edit review already
 * raised was shown to the executor, which judged it and recorded its answer;
 * handing it back a second time is churn, not verification. An advisory that
 * appears only now is the batch's own doing.
 *
 * Advisory throughout, deliberately. These findings are an agent's reading of
 * prose rules, so two reads of the same unchanged file can honestly differ.
 * Scoping to the changed files keeps that narrow, and the consequence — hand it
 * back to be judged — costs one invocation when it is wrong, never a bad verdict.
 */
export const reviewBatchOutput = async ({
	cwd,
	runId,
	driver,
	batch,
	packages,
	channels,
	baseline,
	changedFiles,
	agentReview,
	timeoutMs,
	onProgress,
}: Params): Promise<StandardsFinding[]> => {
	if (changedFiles.length === 0) {
		return [];
	}

	const reviewed = await runBatchReview({ cwd, runId, driver, batch, packages, channels, files: changedFiles, agentReview, timeoutMs, onProgress });

	return findIntroducedFindings({ frozen: baseline, live: reviewed, severity: StandardsSeverity.Advisory });
};

import type { RefactorBatch, StandardsFinding } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { appendReviewFindings } from '#src/runState/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	/** Provenance for the ledger line: which run saw this. */
	runId: string;
	driver: Driver;
	batch: RefactorBatch;
	/** The run's standards packs — the judgment rules the agent reads. */
	packs: LoadedStandardsPack[];
	/** Active framework channels; a document out of play is not reviewed. */
	channels: string[];
	/** The files this read covers: the batch's own before it works, the ones it wrote after. */
	files: string[];
	/** false skips the agent entirely — code-checks-only mode. */
	agentReview: boolean;
	timeoutMs: number;
	onProgress: (message: string) => void;
}

/**
 * One batch-scoped read of the judgment rules, with everything the reviewer
 * could not do narrated against the batch that asked for it.
 *
 * A batch reads those rules twice — over the code it inherited, then over the
 * code it wrote — and the two reads differ only in which files they cover.
 * Sharing the call is what keeps them answering a failed review the same way:
 * a note on the progress stream and no findings, never a silence that reads as
 * a clean review.
 *
 * Whether the agent reads at all is decided here and nowhere else. A batch asks
 * for two reads and a run can opt out of both, so a caller that had to remember
 * the opt-out is a caller that can forget it.
 *
 * Everything the reviewer saw goes to the repo's judgment ledger here, before
 * a caller decides what to do with it. A judgment finding has no second witness
 * the way a checked one does — no code check can rediscover it — so a run that
 * parks or escalates before acting would otherwise take the only account of it
 * to the grave.
 */
export const runBatchReview = async ({
	cwd,
	runId,
	driver,
	batch,
	packs,
	channels,
	files,
	agentReview,
	timeoutMs,
	onProgress,
}: Params): Promise<StandardsFinding[]> => {
	if (!agentReview) {
		return [];
	}

	const review = await runStandardsReview({
		cwd,
		driver,
		packs,
		channels,
		files,
		timeoutMs,
		onProgress: (message) => onProgress(`${batch.id}: ${message}`),
	});

	for (const note of review.notes) {
		onProgress(`${batch.id}: ${note}`);
	}

	await appendReviewFindings({ cwd, runId, step: batch.id, findings: review.findings });

	return review.findings;
};

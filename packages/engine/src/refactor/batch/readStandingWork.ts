import type { RefactorBatch, StandardsFinding } from '#src/contracts/index.ts';
import { matchRemainingFindings } from '#src/refactor/batch/matchRemainingFindings.ts';

interface Params {
	batch: RefactorBatch;
	/** Everything the live pre-check found, from which this batch's own sites are picked out. */
	findings: StandardsFinding[];
	onProgress: (message: string) => void;
}

/**
 * The work a batch actually has left, as the LIVE check sees it.
 *
 * The work-list is frozen when the run starts. By the time a later batch is
 * reached, an earlier one may have fixed one of its sites while editing a file
 * outside its own scope — and the frozen copy also cites pre-run line numbers.
 * Handed the frozen list, an agent went looking for a finding that no longer
 * existed and reported the check as broken, which it was not.
 *
 * An empty result means every site is gone and the batch is already resolved.
 * A shorter one is announced, because "3 blocking" was already printed and a
 * reader who then sees two would otherwise be counting a discrepancy.
 */
export const readStandingWork = ({ batch, findings, onProgress }: Params): StandardsFinding[] => {
	const standing = new Set(matchRemainingFindings({ frozen: batch.blocking, live: findings }));

	if (standing.size > 0 && standing.size < batch.blocking.length) {
		onProgress(
			`${batch.id}: ${batch.blocking.length - standing.size} of ${batch.blocking.length} site(s) already resolved by earlier work — working the ${standing.size} still standing`,
		);
	}

	return findings.filter((finding) => standing.has(finding.siteKey));
};

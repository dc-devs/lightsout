import { appendJsonlRecords } from '#src/common/utils/appendJsonlRecords.ts';
import { ReviewFindingRecord, type StandardsFinding } from '#src/contracts/index.ts';
import { getReviewFindingsPath } from '#src/runState/common/paths/getReviewFindingsPath.ts';

interface Params {
	/** The checkout the run works in — a linked worktree during an isolated run; the primary is resolved from it. */
	cwd: string;
	runId: string;
	/** The batch that was working when the review ran. */
	step: string;
	findings: StandardsFinding[];
}

/**
 * Persist judgment findings to `.lightsout/review-findings.jsonl` in the target
 * repo's primary checkout.
 *
 * Called the moment a review reports them, before anything is spent acting on
 * them: a run that parks or escalates never builds its batch report, and a
 * judgment finding has no second witness the way a checked one does — no code
 * check can rediscover it, so an unwritten one is simply gone.
 */
export const appendReviewFindings = async ({ cwd, runId, step, findings }: Params): Promise<void> =>
	appendJsonlRecords({ path: await getReviewFindingsPath({ cwd }), schema: ReviewFindingRecord, entries: findings, runId, step });

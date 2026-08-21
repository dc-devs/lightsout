import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { ReviewFindingRecord } from '#src/contracts/index.ts';
import { getReviewFindingsPath } from '#src/runState/common/paths/getReviewFindingsPath.ts';

interface Params {
	cwd: string;
}

/**
 * Read the accumulated judgment-review log — what agent reviews have found in
 * this repo, across every run. Validated line-by-line at the boundary;
 * malformed lines are skipped, never guessed at.
 */
export const readReviewFindings = async ({ cwd }: Params): Promise<ReviewFindingRecord[]> =>
	readJsonlRecords({ path: getReviewFindingsPath({ cwd }), schema: ReviewFindingRecord });

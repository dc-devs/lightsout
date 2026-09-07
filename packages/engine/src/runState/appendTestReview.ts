import type { TestReviewRecord } from '#src/contracts/index.ts';
import { appendRunLog } from '#src/runState/common/utils/appendRunLog.ts';

interface Params {
	cwd: string;
	runId: string;
	/** The line to append, as the contract defines it. */
	record: TestReviewRecord;
}

/**
 * Append one test-change review to the run's `test-reviews.jsonl`. Every review
 * is recorded, clean or refused — a checkpoint that judged its test-side
 * changes and approved them all is evidence just as much as one that went red.
 */
export const appendTestReview = async ({ cwd, runId, record }: Params): Promise<void> => {
	await appendRunLog({ cwd, runId, fileName: 'test-reviews.jsonl', record });
};

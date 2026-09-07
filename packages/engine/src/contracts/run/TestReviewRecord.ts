import { z } from 'zod';
import { TestChangeReview } from '#src/contracts/work/TestChangeReview.ts';

/**
 * One line of the run's review journal (`test-reviews.jsonl`): what a
 * verification checkpoint put in front of the test-change reviewer, what it
 * decided, and what the checkpoint went red on.
 *
 * Written on every review, clean or not — a checkpoint that judged its changes
 * and found nothing wrong is evidence too.
 */
export const TestReviewRecord = z.object({
	/** The verification checkpoint that ran the review. */
	checkpoint: z.string().min(1),
	/** ISO timestamp of the review. */
	at: z.string().min(1),
	/** The verdicts as returned, after the engine's own rules were applied. */
	verdicts: TestChangeReview.shape.verdicts,
	/** Every rejection the checkpoint went red on, one line each. Empty on a clean review. */
	rejections: z.array(z.string()).default([]),
});

export type TestReviewRecord = z.infer<typeof TestReviewRecord>;

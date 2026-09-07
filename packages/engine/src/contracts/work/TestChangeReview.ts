import { z } from 'zod';
import { TestDisposition } from '#src/contracts/work/TestDisposition.ts';
import { TestReviewDecision } from '#src/contracts/work/TestReviewDecision.ts';

/**
 * The test-change reviewer's output contract: one verdict per file in the
 * checkpoint's change bundle, plus a disposition for every acceptance test the
 * live mapping states in a file it judged.
 *
 * The engine enforces on top of it what a judge cannot be trusted with — an
 * unreviewed path is a rejection, a verdict outside the bundle is ignored, and
 * every acceptance test must still be locatable by title once the dispositions
 * are applied.
 */
export const TestChangeReview = z.object({
	/** One verdict per file in the bundle. A bundled path with no verdict is rejected by the engine as unreviewed. */
	verdicts: z.array(
		z.object({
			/** Repo-relative path of the bundled file. */
			path: z.string().min(1),
			decision: z.enum(TestReviewDecision),
			/** Why, in one or two sentences. Required for both decisions — an approval has to say what made the change legitimate. */
			reason: z.string().min(1),
			/** One entry per acceptance test the live mapping states in this file. Empty for a file holding none. */
			acceptanceTests: z
				.array(
					z.object({
						/** The test name as the live mapping carries it today. */
						testName: z.string().min(1),
						disposition: z.enum(TestDisposition),
						/** The name it now carries. Required for `renamed` and `replaced`. */
						newTestName: z.string().min(1).optional(),
						/** The file it now lives in. Required for `moved` and `replaced`. */
						testFile: z.string().min(1).optional(),
					}),
				)
				.default([]),
		}),
	),
});

export type TestChangeReview = z.infer<typeof TestChangeReview>;

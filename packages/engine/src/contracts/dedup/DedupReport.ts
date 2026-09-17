import { z } from 'zod';
import { DedupFinding } from '#src/contracts/dedup/DedupFinding.ts';
import { ReviewedCollision } from '#src/contracts/dedup/ReviewedCollision.ts';

/**
 * The persisted `dedup.json`: every confirmed prior-art duplication the Dedup
 * Review pass surfaced for a plan. An empty `findings` array is the clean
 * result — no name-collides remained or the judge ruled every candidate
 * distinct. The skill reads this to conduct the interactive resolution.
 *
 * The coverage pair is what keeps a partial scan honest: one judge per plan file
 * runs concurrently, and a failed or rate-limited judge no longer discards what
 * its siblings found. It ends the pass `complete: false` instead, so an
 * unfinished scan can never be read as "no duplication found".
 *
 * `findings` and `reviewed` answer different questions. The first is the work
 * left to do; the second is what this pass looked at. Only the second can say
 * that a collision still detectable on disk has already been weighed, which is
 * what stops `plan grade` nudging about it for the rest of the plan's life.
 */
export const DedupReport = z.object({
	planName: z.string(),
	findings: z.array(DedupFinding).default([]),
	/**
	 * Every collision this pass ruled on, whatever the ruling — what a later
	 * `plan grade` subtracts before nudging. Empty in a report written before
	 * the field existed, which reads as "nothing recorded" and restores the
	 * older, noisier nudge rather than silencing it.
	 */
	reviewed: z.array(ReviewedCollision).default([]),
	/** False when a judge failed or hit the rate-limit wall; the findings above are real but partial. */
	complete: z.boolean().default(true),
	/** Why the scan did not finish, absent when it did. */
	incompleteReason: z.string().optional(),
	reviewedAt: z.string(),
});

export type DedupReport = z.infer<typeof DedupReport>;

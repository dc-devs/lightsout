import { z } from 'zod';
import { DedupFinding } from '#src/contracts/dedup/DedupFinding.ts';

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
 */
export const DedupReport = z.object({
	planName: z.string(),
	findings: z.array(DedupFinding).default([]),
	/** False when a judge failed or hit the rate-limit wall; the findings above are real but partial. */
	complete: z.boolean().default(true),
	/** Why the scan did not finish, absent when it did. */
	incompleteReason: z.string().optional(),
	reviewedAt: z.string(),
});

export type DedupReport = z.infer<typeof DedupReport>;

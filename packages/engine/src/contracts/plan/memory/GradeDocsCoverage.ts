import { z } from 'zod';

/**
 * The whole-plan documentation checker's own reading.
 *
 * It gets one entry rather than one per plan file because it reads every plan
 * file at once, so what it covers is the deliverable at one set of texts. The
 * file list mirrors `GradeInputs.planFiles` deliberately: whether this entry
 * still stands is the same set comparison, and a second shape for it would be a
 * second answer.
 */
export const GradeDocsCoverage = z.object({
	/** One entry per plan file the checker read, overview included, keyed by basename and sorted by it. */
	planFiles: z.array(z.object({ file: z.string(), designSha256: z.string() })).default([]),
	/** ISO time the check was recorded. */
	at: z.string(),
});

export type GradeDocsCoverage = z.infer<typeof GradeDocsCoverage>;

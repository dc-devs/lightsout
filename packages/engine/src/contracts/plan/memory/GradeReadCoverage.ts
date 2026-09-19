import { z } from 'zod';

/**
 * One reader brief's reading of one plan file: what was read, at what text, and
 * what the plan graph joined it to at the time.
 *
 * It is what lets a later pass skip a reading already paid for. `lens` is a
 * plain string rather than the `GapCheckLens` enum for the reason
 * `GradeInputs.effort` is: an entry is only ever compared for equality against
 * the current brief list, never interpreted, so a memory written under a brief
 * the enum later drops must still parse rather than refusing the whole file.
 */
export const GradeReadCoverage = z.object({
	/** The plan file's basename — the same label `GradedGap.phase` and `GradeReport.phasesChecked` carry. */
	file: z.string(),
	/** The reader brief this entry speaks for, as `GapCheckLens` spells it. */
	lens: z.string(),
	/** sha256 of the plan file's DESIGN text — its content with every engine-generated region removed. */
	designSha256: z.string(),
	/** The phase-graph neighbours this file had when the entry was written, sorted. Empty means the graph joined it to nothing, never that nobody looked. */
	neighbours: z.array(z.string()).default([]),
	/** ISO time the reading was recorded. */
	at: z.string(),
});

export type GradeReadCoverage = z.infer<typeof GradeReadCoverage>;

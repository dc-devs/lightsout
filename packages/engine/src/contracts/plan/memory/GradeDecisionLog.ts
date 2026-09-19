import { z } from 'zod';

/**
 * The decision part of one plan's grading fingerprint — what the scope
 * comparison reads to tell a change to the generated `## Decision Log` apart
 * from a change to the overview's own design text.
 *
 * Every plan carries the rows, a single plan included: a project-wide rule
 * recorded on a plan with no overview has no generated section in any hash, so
 * without the rows nothing would move and the exact-input short-circuit would
 * hand back a grade taken without it.
 *
 * It sits beside the whole-file hashes rather than replacing them: exact-input
 * reuse still sees every decision, and only the choice of how far a pass reaches
 * reads this part.
 */
export const GradeDecisionLog = z.object({
	/**
	 * sha256 of the overview's SHARED design text: its content with every
	 * engine-generated region removed and every span credited to one phase
	 * removed. Absent for a plan with no overview at all, and for a pass recorded
	 * before this hash was measured — both of which mean the same thing to its one
	 * reader, that there is no shared overview text to compare.
	 */
	overviewDesign: z.string().optional(),
	/** One entry per merged decision row, in record order, brainstorm rows first. */
	rows: z.array(
		z.object({
			/** sha256 of the canonical JSON of the whole row. */
			sha256: z.string(),
			/** sha256 of the row's question — what links a revision to the row it supersedes. */
			questionSha256: z.string(),
			/** The phase files the row is taken to reach, as it declares them; absent when it reaches the whole plan. */
			phases: z.array(z.string()).min(1).optional(),
		}),
	),
});

export type GradeDecisionLog = z.infer<typeof GradeDecisionLog>;

import { z } from 'zod';

/**
 * The decision-log part of one phased plan's grading fingerprint — what the
 * scope comparison reads to tell a change to the generated `## Decision Log`
 * apart from a change to the overview's own design text.
 *
 * It sits beside the whole-file hashes rather than replacing them: exact-input
 * reuse still sees every decision, and only the choice of how far a pass reaches
 * reads this part.
 */
export const GradeDecisionLog = z.object({
	/** sha256 of the overview's text with its Decision Log span removed; of the whole text when the overview has no such span. */
	overview: z.string(),
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

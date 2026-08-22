/**
 * The brief one gap-check agent is given. Three agents check every phase, each
 * with a different job, and everything they find is combined as a union — not
 * voted on.
 *
 * Identical checkers concentrate their attention in the same places, which is
 * why the same phase graded four times returned a different count each time
 * with every reported gap real. Different jobs cover more of the document.
 */
export const GapCheckLens = {
	/** What each file must expose: methods, signatures, behaviour, return values. */
	Surface: 'surface',
	/** How the pieces connect: exports against imports, prerequisites, hand-offs, integration points. */
	Wiring: 'wiring',
	/** What was never decided: edge cases, error handling, and contradictions with the standards. */
	Decisions: 'decisions',
} as const;

export type GapCheckLens = (typeof GapCheckLens)[keyof typeof GapCheckLens];

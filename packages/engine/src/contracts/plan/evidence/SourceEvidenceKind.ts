/**
 * How one evidence entry relates to the file it was taken from.
 *
 * `Missing` is load-bearing rather than defensive: `verifyFacts` checks the
 * `filesToModify` and `patternsToMirror` paths on disk but never an integration
 * point's `at` location, so a facts record that passed verification can still
 * name a path that is not there. That has to be recorded as a fact about the
 * repository, not abort the draft.
 */
export const SourceEvidenceKind = {
	/** The file's full text, verbatim. */
	Whole: 'whole',
	/** Selected whole definitions from a file too large to carry in full. */
	Definitions: 'definitions',
	/** The facts named this path and nothing was on disk at it. */
	Missing: 'missing',
} as const;

export type SourceEvidenceKind = (typeof SourceEvidenceKind)[keyof typeof SourceEvidenceKind];

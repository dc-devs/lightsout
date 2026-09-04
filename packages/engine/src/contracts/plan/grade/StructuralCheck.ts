/**
 * The deterministic structural checks a plan is linted against in code (the
 * mechanical half of grading — heading paths, the paths its prose names,
 * scripts, placeholders, sections, scope, naming), plus the cross-phase checks
 * a phased plan is held to as a whole:
 * where each path comes from, whether the hand-offs chain, whether the
 * overview's declarations match the phase files, and how many phases there are.
 * The two ledger checks read a contract plan's `## Acceptance Tests` table: one
 * asks whether every row and prose-files exemption is well formed, the other
 * whether the plan's source files are all reached by a row or excused with a
 * reason.
 * Values are internal to findings reports.
 */
export const StructuralCheck = {
	PathExists: 'path-exists',
	ProsePathExists: 'prose-path-exists',
	ScriptExists: 'script-exists',
	NoPlaceholders: 'no-placeholders',
	SectionsPresent: 'sections-present',
	ScopeWithinGuardrail: 'scope-within-guardrail',
	NamingMatches: 'naming-matches',
	PackagesIdentifiable: 'packages-identifiable',
	FileProvenance: 'file-provenance',
	HandoffChained: 'handoff-chained',
	DeclarationConsistent: 'declaration-consistent',
	CreatedFilesWithinCeiling: 'created-files-within-ceiling',
	PhaseCount: 'phase-count',
	MoveWellFormed: 'move-well-formed',
	LedgerWellFormed: 'ledger-well-formed',
	LedgerCovers: 'ledger-covers',
} as const;

export type StructuralCheck = (typeof StructuralCheck)[keyof typeof StructuralCheck];

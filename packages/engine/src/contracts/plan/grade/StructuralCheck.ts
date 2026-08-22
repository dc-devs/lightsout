/**
 * The deterministic structural checks a plan is linted against in code (the
 * mechanical half of grading — paths, scripts, placeholders, sections, scope,
 * naming), plus the cross-phase checks a phased plan is held to as a whole:
 * where each path comes from, whether the hand-offs chain, whether the
 * overview's declarations match the phase files, and how many phases there are.
 * Values are internal to findings reports.
 */
export const StructuralCheck = {
	PathExists: 'path-exists',
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
} as const;

export type StructuralCheck = (typeof StructuralCheck)[keyof typeof StructuralCheck];

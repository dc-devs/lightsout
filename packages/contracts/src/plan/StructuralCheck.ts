/**
 * The deterministic structural checks a plan is linted against in code (the
 * mechanical half of grading — paths, scripts, placeholders, sections, scope,
 * naming). Values are internal to findings reports.
 */
export const StructuralCheck = {
	PathExists: 'path-exists',
	ScriptExists: 'script-exists',
	NoPlaceholders: 'no-placeholders',
	SectionsPresent: 'sections-present',
	ScopeWithinGuardrail: 'scope-within-guardrail',
	NamingMatches: 'naming-matches',
	PackagesIdentifiable: 'packages-identifiable',
} as const;

export type StructuralCheck = (typeof StructuralCheck)[keyof typeof StructuralCheck];

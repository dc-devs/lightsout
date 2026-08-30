/**
 * The kinds of decision-level gap the gap-check agent surfaces — the places a
 * plan would force the implementing agent to guess. Values are internal to
 * findings reports.
 *
 * `MissingDocumentation` is the one member no per-file lens reports: it is
 * stamped on the whole-plan documentation checker's findings, and only in a
 * repository that declares a `docs` block.
 */
export const GapArea = {
	UnderspecifiedSurface: 'underspecified-surface',
	UnwiredDependency: 'unwired-dependency',
	InsufficientDetail: 'insufficient-detail',
	OmittedDecision: 'omitted-decision',
	AmbiguousBoundary: 'ambiguous-boundary',
	StandardsConflict: 'standards-conflict',
	PhaseSeamMismatch: 'phase-seam-mismatch',
	MissingDocumentation: 'missing-documentation',
} as const;

export type GapArea = (typeof GapArea)[keyof typeof GapArea];

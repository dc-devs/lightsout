/**
 * The kinds of decision-level gap the gap-check agent surfaces — the places a
 * plan would force the implementing agent to guess. Values are internal to
 * findings reports.
 */
export const GapArea = {
	UnderspecifiedSurface: 'underspecified-surface',
	UnwiredDependency: 'unwired-dependency',
	InsufficientDetail: 'insufficient-detail',
	OmittedDecision: 'omitted-decision',
	AmbiguousBoundary: 'ambiguous-boundary',
	StandardsConflict: 'standards-conflict',
} as const;

export type GapArea = (typeof GapArea)[keyof typeof GapArea];

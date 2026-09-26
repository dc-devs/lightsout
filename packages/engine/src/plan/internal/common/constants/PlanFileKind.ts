/**
 * Which of the two shapes a parsed plan FILE has: an overview fronting a phase
 * set, or a file that is itself implementable. Distinct from `PlanVariant`,
 * which names the deliverable a draft was asked for (`single` / `overview` /
 * `phase`) — the parser only ever needs the coarser two-way split, and the two
 * unions must not share a literal by accident: `PlanVariant.Single` would
 * compile against a plan-file kind and be silently never equal to it.
 */
export const PlanFileKind = {
	Implementable: 'implementable',
	Overview: 'overview',
} as const;

export type PlanFileKind = (typeof PlanFileKind)[keyof typeof PlanFileKind];

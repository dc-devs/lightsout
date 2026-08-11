/**
 * Shape of a written plan deliverable. The CLI `--scope single|phased` maps
 * `phased` → `Overview` (the overview file that fronts the phase files).
 */
export const PlanVariant = {
	Single: 'single',
	Overview: 'overview',
	Phase: 'phase',
} as const;

export type PlanVariant = (typeof PlanVariant)[keyof typeof PlanVariant];

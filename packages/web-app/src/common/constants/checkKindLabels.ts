import { CheckKind } from '#src/common/constants/CheckKind.ts';

/**
 * How each kind of check is named, defined once so no page words it for itself:
 * the full label, the short one a tag or a filter has room for, the plural a
 * count reads with, and the one-line definition a reader is given once.
 */
export const checkKindLabels: Record<CheckKind, { label: string; short: string; plural: string; definition: string }> = {
	[CheckKind.Deterministic]: {
		label: 'Deterministic check',
		short: 'Deterministic',
		plural: 'deterministic checks',
		definition: 'Code decides, with the same answer every run.',
	},
	[CheckKind.Agent]: {
		label: 'Agent check',
		short: 'Agent',
		plural: 'agent checks',
		definition: 'An agent reviews the change against the rule.',
	},
};

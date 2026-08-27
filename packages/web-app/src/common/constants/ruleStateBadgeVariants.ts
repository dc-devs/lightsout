import { StandardsSeverity } from '@lightsout/engine/contracts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

/**
 * The colour family each state a loaded rule can run at speaks in.
 *
 * Three values rather than the two a pack ships: `off` exists only once a repo's
 * config has spoken, so this is the table for anything showing what a rule does
 * HERE — the config page's ledger and the rule page's local section — while
 * `severityBadgeVariants` stays the table for what a pack declares.
 */
export const ruleStateBadgeVariants: Record<StandardsSeverity, BadgeVariant> = {
	[StandardsSeverity.Blocking]: BadgeVariant.Blocking,
	[StandardsSeverity.Advisory]: BadgeVariant.Advisory,
	[StandardsSeverity.Off]: BadgeVariant.Neutral,
};

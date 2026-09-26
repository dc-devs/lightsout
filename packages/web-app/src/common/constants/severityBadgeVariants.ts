import { StandardsSeverity } from '@lightsout/engine/contracts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

/**
 * The colour family each severity speaks in, wherever it is shown: what a pack
 * ships a rule at, and what a repo's config runs it at.
 *
 * Total over all three, since both can be `off` — a repo turns a rule off when
 * its own linter enforces it, and a pack ships one off for repos to opt into.
 */
export const severityBadgeVariants: Record<StandardsSeverity, BadgeVariant> = {
	[StandardsSeverity.Blocking]: BadgeVariant.Blocking,
	[StandardsSeverity.Advisory]: BadgeVariant.Advisory,
	[StandardsSeverity.Off]: BadgeVariant.Neutral,
};

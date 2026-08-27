import type { StandardsPackRuleListing } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

/**
 * The colour family each severity a pack can ship speaks in.
 *
 * A pack's rule ships blocking or advisory and never `off`, so the table is
 * total — the rule page and the rule row read the same two answers instead of
 * each writing a ternary whose else-branch quietly stands in for a third value.
 */
export const severityBadgeVariants: Record<StandardsPackRuleListing['defaultSeverity'], BadgeVariant> = {
	[StandardsSeverity.Blocking]: BadgeVariant.Blocking,
	[StandardsSeverity.Advisory]: BadgeVariant.Advisory,
};

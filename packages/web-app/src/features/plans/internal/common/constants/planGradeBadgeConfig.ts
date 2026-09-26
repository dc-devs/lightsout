import { PlanGrade } from '@lightsout/engine/contracts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

/**
 * Grade → badge label and family. Passed straight to `StatusBadge`'s `config`.
 *
 * Below-A wears the advisory family rather than the failed one: a plan that has
 * not reached A is unfinished, not broken.
 */
export const planGradeBadgeConfig: Record<PlanGrade, { label: string; variant: BadgeVariant }> = {
	[PlanGrade.A]: { label: 'A', variant: BadgeVariant.Passed },
	[PlanGrade.BelowA]: { label: 'below A', variant: BadgeVariant.Advisory },
};

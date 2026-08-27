import type { StandardsPackRuleListing } from '@lightsout/engine';
import { hasRuleFixtures } from '#src/features/packs/common/utils/hasRuleFixtures.ts';

interface Params {
	rules: StandardsPackRuleListing[];
}

/**
 * Whether any rule in the pack still carries the examples that prove it.
 *
 * Two places ask: the showcase, which has nothing to show, and the header,
 * which says why.
 *
 * @param rules - every rule the pack holds
 */
export const hasPackFixtures = ({ rules }: Params): boolean => rules.some((rule) => hasRuleFixtures({ rule }));

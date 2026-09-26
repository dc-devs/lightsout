import { baseRuleSetSlug } from '#src/features/packs/internal/common/constants/baseRuleSetSlug.ts';

interface Params {
	ruleSet: string;
}

/**
 * The channel a rule-set address names — `toRuleSetSlug` read backwards.
 *
 * @param ruleSet - the address word, as the URL carries it
 */
export const toRuleSetChannel = ({ ruleSet }: Params): string => (ruleSet === baseRuleSetSlug ? 'base' : ruleSet);

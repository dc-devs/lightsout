import type { StandardsPackRuleListing } from '@lightsout/engine';
import type { PackRuleFilters } from '#src/features/packs/common/types/PackRuleFilters.ts';

interface Params {
	rules: StandardsPackRuleListing[];
	filters: PackRuleFilters;
}

/**
 * The rules left after everything a reader narrowed to.
 *
 * The four vocabulary filters match exactly and the free-text one is a
 * case-insensitive substring of either the rule's id or its summary — a reader
 * types "any" and means the rule about `any`, not a regular expression.
 *
 * @param rules - every rule the pack holds
 * @param filters - what to narrow by; an absent key narrows nothing
 */
export const filterPackRules = ({ rules, filters }: Params): StandardsPackRuleListing[] => {
	const text = filters.text?.trim().toLowerCase() ?? '';

	return rules.filter(
		(rule) =>
			(filters.set === undefined || rule.set === filters.set) &&
			(filters.channel === undefined || rule.channel === filters.channel) &&
			(filters.checked === undefined || rule.checked === filters.checked) &&
			(filters.severity === undefined || rule.defaultSeverity === filters.severity) &&
			(text === '' || rule.id.toLowerCase().includes(text) || rule.summary.toLowerCase().includes(text)),
	);
};

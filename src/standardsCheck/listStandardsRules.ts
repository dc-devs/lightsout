import type { LightsoutConfig } from '@/contracts';
import type { StandardsRuleListing } from '@/standardsCheck/common/types/StandardsRuleListing';
import { resolveRuleStates } from '@/standardsCheck/resolveRuleStates';
import { standardsRuleRegistry } from '@/standardsCheck/standardsRuleRegistry';

interface Params {
	config?: LightsoutConfig;
}

/** Every rule with its doc, its summary and its state in this repo — sorted by rule id, so `--list` output diffs cleanly. */
export const listStandardsRules = ({ config }: Params): StandardsRuleListing[] => {
	// Walked from the resolved states rather than the rule list, so a rule can
	// never be listed with a state nobody resolved for it.
	return [...resolveRuleStates({ config })]
		.map(([rule, state]) => ({
			rule,
			doc: standardsRuleRegistry[rule].doc,
			summary: standardsRuleRegistry[rule].summary,
			severity: state.severity,
			fromConfig: state.fromConfig,
			settings: state.settings,
		}))
		.sort((first, second) => first.rule.localeCompare(second.rule));
};

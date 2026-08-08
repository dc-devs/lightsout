import { StandardsRule, type LightsoutConfig } from '@/contracts';
import type { ResolvedRuleState } from '@/standardsCheck/common/types/ResolvedRuleState';
import { standardsRuleRegistry } from '@/standardsCheck/standardsRuleRegistry';

interface Params {
	config?: LightsoutConfig;
}

/**
 * Every rule's severity and settings for this run: the registry's defaults,
 * with the repo's `standardsChecks` entries layered over them. A rule the
 * config does not name keeps its own default — silence is never a change.
 */
export const resolveRuleStates = ({ config }: Params): Map<StandardsRule, ResolvedRuleState> => {
	const states = new Map<StandardsRule, ResolvedRuleState>();

	for (const rule of Object.values(StandardsRule)) {
		const definition = standardsRuleRegistry[rule];
		const override = config?.standardsChecks?.[rule];
		const object = typeof override === 'object' ? override : undefined;

		states.set(rule, {
			severity: (typeof override === 'string' ? override : object?.severity) ?? definition.defaultSeverity,
			settings: { ...definition.defaultSettings, ...object?.settings },
			fromConfig: override !== undefined,
		});
	}

	return states;
};

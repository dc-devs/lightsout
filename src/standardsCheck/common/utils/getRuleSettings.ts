import type { StandardsRule } from '@/contracts';
import type { ResolvedRuleState } from '@/standardsCheck/common/types/ResolvedRuleState';
import { standardsRuleRegistry } from '@/standardsCheck/standardsRuleRegistry';

interface Params {
	states: Map<StandardsRule, ResolvedRuleState>;
	rule: StandardsRule;
}

/**
 * One rule's numeric knobs for this run: the registry's defaults with the run's
 * resolved state layered over them.
 *
 * The registry layer is not redundant with `resolveRuleStates` — it is what
 * lets a pass be handed a partial states map (a direct test, a future caller)
 * and still measure against the standards' own numbers rather than nothing.
 * A module internal; its behaviour is pinned through the passes that read it.
 */
export const getRuleSettings = ({ states, rule }: Params): Record<string, number> => ({
	...standardsRuleRegistry[rule].defaultSettings,
	...states.get(rule)?.settings,
});

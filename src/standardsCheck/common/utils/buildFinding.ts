import type { StandardsFinding, StandardsRule } from '@/contracts';
import { buildSiteKey } from '@/standardsCheck/common/utils/buildSiteKey';
import { standardsRuleRegistry } from '@/standardsCheck/standardsRuleRegistry';

interface Params {
	rule: StandardsRule;
	files: StandardsFinding['files'];
	detail: string;
	guidance: string;
}

/**
 * One finding, with its identity and its severity derived rather than written.
 *
 * Every pass emits through here, which turns two invariants into structure
 * instead of a convention each emit site has to remember: a finding's site key
 * is always `buildSiteKey` over the very paths it reports — never a subset a
 * pass computed separately — and the severity a pass emits is always its rule's
 * registry default, which `runStandardsCheck` then overwrites with the repo's
 * resolved value.
 *
 * A module internal — its behaviour is pinned through the passes that emit
 * through it, which is where every rule's finding shape is already asserted.
 */
export const buildFinding = ({ rule, files, detail, guidance }: Params): StandardsFinding => ({
	rule,
	severity: standardsRuleRegistry[rule].defaultSeverity,
	siteKey: buildSiteKey({ rule, files }),
	files,
	detail,
	guidance,
});

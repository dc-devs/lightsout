import type { StandardsPassId, StandardsSeverity } from '@/contracts';

export interface StandardsRuleDefinition {
	/** Repo-relative path of the standards doc this rule enforces — printed by `--list` so a reader can go read the rule. */
	doc: string;
	/** One line: what the rule catches, in the doc's own words. */
	summary: string;
	/** The severity the rule reports at when the repo says nothing. Never `off` — a rule that ships off is a rule nobody turns on. */
	defaultSeverity: Exclude<StandardsSeverity, typeof StandardsSeverity.Off>;
	/** The pass that produces this rule's findings. */
	pass: StandardsPassId;
	/** True when the pass cannot run without a resolvable consumer TypeScript. */
	needsTypescript: boolean;
	/** The rule's own numeric knobs, merged under the repo's config overrides. Omitted when the rule has none. */
	defaultSettings?: Record<string, number>;
}

import type { StandardsRule, StandardsSeverity } from '@/contracts';

export interface StandardsRuleListing {
	rule: StandardsRule;
	doc: string;
	summary: string;
	severity: StandardsSeverity;
	/** True when this repo's config set the severity or the settings. */
	fromConfig: boolean;
	settings: Record<string, number>;
}

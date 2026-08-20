import type { StandardsSeverity } from '#src/contracts/index.ts';

export interface StandardsRuleListing {
	/** The rule id — a plain string, the same one a finding and the config carry. */
	rule: string;
	/** '<package name>: <document folder>' — which package states the rule, and where in it. */
	doc: string;
	summary: string;
	/** True when the rule ships a check code runs; false when it is judgment an agent has to read. */
	checked: boolean;
	severity: StandardsSeverity;
	/** True when this repo's config set the severity or the settings. */
	fromConfig: boolean;
	settings: Record<string, number>;
}

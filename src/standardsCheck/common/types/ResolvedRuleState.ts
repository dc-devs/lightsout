import type { StandardsSeverity } from '@/contracts';

export interface ResolvedRuleState {
	/** May be `off` — `runStandardsCheck` drops those findings before anything else sees them. */
	severity: StandardsSeverity;
	settings: Record<string, number>;
	/** True when the repo's config named this rule — `--list` marks those rows so a reader can tell policy from default. */
	fromConfig: boolean;
}

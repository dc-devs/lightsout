import type { StandardsSeverity } from '#src/contracts/index.ts';

export interface ResolvedRuleState {
	/** May be `off` — a rule resolved to `off` is never run, so no finding ever carries it. */
	severity: StandardsSeverity;
	settings: Record<string, number>;
	/** True when the repo's config named this rule — `--list` marks those rows so a reader can tell policy from default. */
	fromConfig: boolean;
}

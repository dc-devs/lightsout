import type { DecisionsRecord, Effort, LightsoutConfig, Permissions, PlanFacts } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';

/**
 * Everything both draft flows read, resolved once before either runs. It exists
 * so the single and phased flows take one parameter rather than fourteen each,
 * and so the escalation from one to the other hands over exactly the state the
 * first flow started from.
 */
export interface DraftContext {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	workspaceDir: string;
	facts: PlanFacts;
	decisions: DecisionsRecord;
	/** Absolute path of the workspace's brainstorm-decisions.json when one exists. */
	brainstormDecisionsPath?: string;
	config?: LightsoutConfig;
	/** `executor-file-limit` from config, already defaulted — the one number the lint, the estimate and both prompts read. */
	executorFileLimit: number;
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	progress: (message: string) => void;
}

import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { Permissions } from '#src/contracts/Permissions.ts';
import type { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
import type { DraftImplementation } from '#src/contracts/plan/draft/DraftImplementation.ts';
import type { SourceEvidenceIndex } from '#src/contracts/plan/evidence/SourceEvidenceIndex.ts';
import type { PlanFacts } from '#src/contracts/plan/facts/PlanFacts.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';

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
	/** Which drafting implementation is running. Required, because every result carries it and a context that could omit it would let a flow build a result that does not say what produced it. */
	implementation: DraftImplementation;
	/** The source evidence collected once for this draft. Present only on a focused draft — a legacy draft never collects it and must not pay for it. */
	evidence?: SourceEvidenceIndex;
	config?: LightsoutConfig;
	/** `executor-file-limit` from config, already defaulted — the one number the lint, the estimate and both prompts read. */
	executorFileLimit: number;
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	/** The level a draft flow's spawns attach to — the command run. Absent wherever no run is being recorded. Held on the context so both flows and every helper handed the whole context are wired identically. */
	level?: ActivityLevel;
	progress: (message: string) => void;
}

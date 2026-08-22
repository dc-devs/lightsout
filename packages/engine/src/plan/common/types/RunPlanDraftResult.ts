import type { PlanDraftReport, PlanVariant, StructuralFinding } from '#src/contracts/index.ts';
import type { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';

/** A draft that converged: every written path, the variant it came out as, and one report per spawn. */
interface PlanDraftComplete {
	status: typeof PlanRunStatus.Complete;
	workspaceDir: string;
	planPaths: string[];
	variant: PlanVariant;
	/** The overview spawn's report first, then one per phase in phase order. A single plan returns one element. */
	reports: PlanDraftReport[];
	advisories: StructuralFinding[];
}

/** A spawn that died, or an engine check the draft could not get past. */
interface PlanDraftFailed {
	status: typeof PlanRunStatus.Failed;
	workspaceDir: string;
	error: string;
	advisories: StructuralFinding[];
}

/** The harness rate-limit wall — resumable, not an error. */
interface PlanDraftPaused {
	status: typeof PlanRunStatus.PausedRateLimit;
	workspaceDir: string;
	error: string;
	advisories: StructuralFinding[];
}

/** The writer found the facts or decisions do not match the codebase; the inputs are wrong, so the draft never loops. */
interface PlanDraftFactsError {
	status: typeof PlanRunStatus.FactsError;
	workspaceDir: string;
	discrepancies: string[];
	advisories: StructuralFinding[];
}

/** Blocking findings the repair loops could not converge, handed back with the draft intact. */
interface PlanDraftStructuralIssues {
	status: typeof PlanRunStatus.StructuralIssues;
	workspaceDir: string;
	findings: StructuralFinding[];
	planPaths: string[];
	advisories: StructuralFinding[];
}

/**
 * How a `plan draft` run came to rest.
 *
 * `advisories` rides every member, not only the success case: it is information
 * the human wants whichever way the draft ended, and `[]` wherever the draft
 * stopped before any check could produce one.
 */
export type RunPlanDraftResult = PlanDraftComplete | PlanDraftFailed | PlanDraftPaused | PlanDraftFactsError | PlanDraftStructuralIssues;

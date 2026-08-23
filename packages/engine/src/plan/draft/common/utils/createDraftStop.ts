import type { StructuralFinding } from '#src/contracts/index.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';

/** Distributes across the result union so every member keeps its own shape instead of collapsing into one merged object. */
type DraftStopFields<Result> = Result extends unknown ? Omit<Result, 'workspaceDir' | 'advisories'> : never;

interface Params {
	workspaceDir: string;
	/** Read at each stop rather than at creation, so a warning raised on the way past one check rides every exit after it. */
	advisories: StructuralFinding[];
}

/**
 * Stamp the two fields every `RunPlanDraftResult` carries — the workspace and
 * the advisories accumulated so far — onto whichever status-specific fields a
 * draft flow came to rest with.
 *
 * Both flows are linear fallible pipelines with a stop after every step, and
 * hand-spelling the shared fields at each one is how the next exit added ships
 * without them. Funnelling the shapes through one stamper makes that
 * impossible: a flow states only what is particular to how it stopped.
 */
export const createDraftStop = ({ workspaceDir, advisories }: Params): ((fields: DraftStopFields<RunPlanDraftResult>) => RunPlanDraftResult) => {
	return (fields) => ({ ...fields, workspaceDir, advisories: [...advisories] });
};

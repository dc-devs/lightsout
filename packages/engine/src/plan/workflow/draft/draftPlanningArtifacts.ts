import { type PlanningRoleResult, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { selectWritablePlanningArtifacts } from '#src/plan/workflow/common/utils/selectWritablePlanningArtifacts.ts';
import { renderPlanningContract } from '#src/plan/workflow/draft/renderPlanningContract.ts';
import { invokePlanningRole } from '#src/plan/workflow/invokePlanningRole.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	work: PlanningWork;
}

/** Draft or repair only a claimed scope through the observed, lease-bound focused invocation owner. */
export const draftPlanningArtifacts = async ({ runtime, snapshot, work }: Params): Promise<PlanningRoleResult> => {
	if (work.role !== PlanningVocabulary.Role.Draft && work.role !== PlanningVocabulary.Role.Repair)
		throw new Error('Planning authoring requires a draft or repair assignment');
	const outputs = selectWritablePlanningArtifacts({ record: snapshot.record, scope: work.scope });
	if (outputs.length === 0 && work.role === PlanningVocabulary.Role.Draft) throw new Error('Planning drafting requires an established artifact layout');
	for (const output of outputs) renderPlanningContract({ snapshot, phaseId: output.phaseId });
	// JSON edits are durable isolated attempt outputs; only applyPlanningResult can publish their canonical bytes.
	return invokePlanningRole({ runtime, snapshot, work });
};

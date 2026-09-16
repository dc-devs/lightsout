import { type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { invokePlanningRole } from '#src/plan/workflow/invokePlanningRole.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
}

/** Invoke the actual distinct final reviewer over the complete original design and current integration evidence. */
export const reviewPlanningIntegration = async ({ runtime, snapshot }: Params): Promise<PlanningRoleResult> => {
	const work = snapshot.record.work.filter(
		(work) => work.role === PlanningVocabulary.Role.IntegrationReview && work.stage === runtime.stage && work.status === PlanningVocabulary.WorkState.Running,
	);
	if (work.length !== 1 || work[0].scope.kind !== PlanningVocabulary.Scope.WholePlan)
		throw new Error('Final integration requires one exclusively claimed whole-plan assignment');
	return invokePlanningRole({ runtime, snapshot, work: work[0] });
};

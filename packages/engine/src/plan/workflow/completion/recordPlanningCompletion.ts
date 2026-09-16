import { PlanningVocabulary } from '#src/contracts/index.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/common/review/planningIntegrationBasis.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningCycle } from '#src/plan/workflow/common/types/PlanningCycle.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningCompletionReceipt } from '#src/plan/workflow/completion/common/types/PlanningCompletionReceipt.ts';

interface Params {
	runtime: PlanningRuntime;
	cycle: PlanningCycle;
}

/** Preserve the successful engine cycle for publication without adding semantic obligations or fabricating reviews. */
export const recordPlanningCompletion = async ({ runtime, cycle }: Params): Promise<PlanningSnapshot> => {
	if (
		!cycle.readiness?.ready ||
		cycle.snapshot.record.work.some((work) => work.stage === runtime.stage && work.status !== PlanningVocabulary.WorkState.Complete)
	)
		throw new Error('Unfinished planning cannot record completion');
	const receipt = PlanningCompletionReceipt.parse({
		format: 'planning-completion-v1',
		stage: runtime.stage,
		basis: planningIntegrationBasis({ snapshot: cycle.snapshot }),
		executionPolicyDigest: cycle.snapshot.record.executionPolicies?.find((policy) => policy.stage === runtime.stage)?.sha256,
		...(cycle.assurance?.unknownDependencyIds.length ? { assurance: cycle.assurance } : {}),
	});
	return updatePlanningSnapshot({
		runtime,
		propose: async (current) => {
			if (current.digest !== cycle.snapshot.digest) throw new Error('Planning changed before its completion checkpoint');
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			attachPlanningData({ record, artifacts, path: `planning-completion/${runtime.stage}.json`, value: receipt });
			return { record, artifacts };
		},
	});
};

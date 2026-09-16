import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningHandoff, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { orderPlanningPhases } from '#src/plan/workflow/common/utils/orderPlanningPhases.ts';
import { readPlanningCompletion } from '#src/plan/workflow/completion/index.ts';
import { evaluatePlanningReadiness } from '#src/plan/workflow/review/index.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	cwd: string;
	handoff: PlanningHandoff;
}
/** Reopen the original generation, never the current publication or mutable Markdown projections. */
export const readPlanningHandoff = async ({ cwd, handoff }: Params): Promise<PlanningSnapshot> => {
	const snapshot = await readPlanningSnapshot({ cwd, name: handoff.name, generation: handoff.generation });
	if (!snapshot) throw new Error('The original planning handoff is missing; restore it before resuming');
	const completion = readPlanningCompletion({ snapshot, stage: PlanningVocabulary.Stage.Implementation });
	if (!completion) throw new Error('The handoff has no completed planning cycle');
	const readiness = evaluatePlanningReadiness({
		snapshot,
		structural: [],
		dependenciesCurrent: true,
		stage: PlanningVocabulary.Stage.Implementation,
		assurance: completion.assurance,
	});
	if (!readiness.ready) throw new Error(`The original handoff is incomplete: ${readiness.missingReason}`);
	const phases = orderPlanningPhases({ record: snapshot.record }).map((artifact) => ({ id: artifact.phaseId, path: artifact.path }));
	if (canonicalJson({ value: phases }) !== canonicalJson({ value: handoff.phases })) throw new Error('Frozen planning phase order changed');
	return snapshot;
};

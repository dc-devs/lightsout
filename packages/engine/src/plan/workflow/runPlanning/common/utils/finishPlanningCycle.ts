import { PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { resolvePlanningAlignment } from '#src/plan/workflow/review/index.ts';
import type { PlanningCycle } from '#src/plan/workflow/runPlanning/common/types/PlanningCycle.ts';
import { materializePlanningViews } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	cycle: PlanningCycle;
}

/** Alignment and implementation completion certify different evidence, both against one immutable generation. */
export const finishPlanningCycle = async ({ runtime, cycle }: Params): Promise<PlanningRunResult | undefined> => {
	const { snapshot, readiness } = cycle;
	if (!readiness) throw new Error('Completion requires a freshly evaluated planning cycle');
	let result: PlanningRunResult | undefined;
	const pending = snapshot.record.work.filter((work) => work.stage === runtime.stage && work.status !== PlanningVocabulary.WorkState.Complete);
	if (readiness.ready && pending.length === 0) {
		if (runtime.stage === PlanningVocabulary.Stage.Brainstorm) {
			const alignment = resolvePlanningAlignment({ snapshot });
			if (!alignment) {
				result = {
					status: PlanningVocabulary.Status.ExternallyBlocked,
					name: runtime.name,
					generation: snapshot.digest,
					continuation: runtime.name,
					cause: 'Brainstorm alignment requires explicit approved source/delegation and a current independent challenge.',
				};
			} else {
				result = {
					status: PlanningVocabulary.Status.Aligned,
					name: runtime.name,
					generation: snapshot.digest,
					readiness,
					...alignment,
				};
			}
		} else {
			const deliverables = snapshot.record.artifacts
				.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data)
				.map((artifact) => artifact.path);
			await materializePlanningViews({ cwd: runtime.cwd, name: runtime.name, snapshot });
			result = { status: PlanningVocabulary.Status.Complete, name: runtime.name, generation: snapshot.digest, readiness, deliverables };
		}
	}
	return result === undefined ? undefined : PlanningRunResult.parse(result);
};

import { type PlanningDependency, PlanningVocabulary } from '#src/contracts/index.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/invocation/PlanningBaseline.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Active investigator and independent consumer predicates supersede historical author inputs; pending evidence never authorizes reuse. */
export const collectPlanningDependencies = ({ snapshot }: Params): PlanningDependency[] => {
	const dependencies: PlanningDependency[] = snapshot.record.evidence.filter((item) => item.complete).flatMap((item) => item.dependencies);
	for (const [path, text] of snapshot.artifacts) {
		if (!path.startsWith('planning-baselines/')) continue;
		const baseline = PlanningBaseline.parse(JSON.parse(text));
		if (
			snapshot.record.work.some(
				(work) =>
					[
						PlanningVocabulary.Role.Investigate,
						PlanningVocabulary.Role.DesignReview,
						PlanningVocabulary.Role.ImplementationReview,
						PlanningVocabulary.Role.IntegrationReview,
					].some((role) => role === work.role) &&
					work.id === baseline.workId &&
					work.status === PlanningVocabulary.WorkState.Complete &&
					work.resultReceiptId === baseline.resultReceiptId,
			)
		)
			dependencies.push(...baseline.dependencies.filter((dependency) => dependency.kind !== PlanningVocabulary.Dependency.Collection));
	}
	return dependencies;
};

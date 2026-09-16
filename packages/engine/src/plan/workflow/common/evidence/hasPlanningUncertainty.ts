import { type PlanningEvidence, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	evidence: PlanningEvidence;
}

/** Declared or observed unknown reach remains a required obligation even without prose or linked claims. */
export const hasPlanningUncertainty = ({ evidence }: Params): boolean =>
	evidence.dependencyReach === PlanningVocabulary.DependencyReach.Unknown ||
	evidence.dependencies.some((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown);

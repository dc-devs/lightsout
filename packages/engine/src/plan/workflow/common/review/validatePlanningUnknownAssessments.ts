import { type PlanningCitation, type PlanningEvidence, type PlanningUnknownAssessment, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	assignedIds: ReadonlySet<string>;
	claimIds: ReadonlySet<string>;
	evidence: PlanningEvidence[];
	assessments: PlanningUnknownAssessment[];
	validateCitations: (params: { citations: PlanningCitation[] }) => Promise<void>;
}

/** Share the same explicit unknown-reach bar across planning approval and run-owned implementation compatibility. */
export const validatePlanningUnknownAssessments = async ({ assignedIds, claimIds, evidence, assessments, validateCitations }: Params): Promise<string[]> => {
	if ([...assignedIds].some((id) => !assessments.some((item) => item.dependencyIds.includes(id))))
		throw new Error('Unknown reach requires a fresh explicit assessment of every obligation');
	const blockedReasons: string[] = [];
	for (const assessment of assessments) {
		if (assessment.dependencyIds.some((id) => !assignedIds.has(id)) || assessment.claimIds.some((id) => !claimIds.has(id)))
			throw new Error('Unknown assessment references an unassigned dependency or claim');
		await validateCitations({ citations: assessment.citations });
		if (assessment.outcome === PlanningVocabulary.UnknownAssessment.Unavailable) blockedReasons.push(`${assessment.paths.join(', ')}: ${assessment.reason}`);
		if (
			assessment.outcome === PlanningVocabulary.UnknownAssessment.Acquired &&
			!assessment.evidenceIds.some((id) => evidence.some((item) => item.id === id && item.dependencyReach === PlanningVocabulary.DependencyReach.Known))
		)
			throw new Error('Acquired unknown information requires independently observed evidence');
	}
	return blockedReasons;
};

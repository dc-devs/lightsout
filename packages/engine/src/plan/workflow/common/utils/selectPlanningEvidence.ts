import { type PlanningEvidence, type PlanningRecord, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { hasPlanningUncertainty } from '#src/plan/workflow/common/evidence/hasPlanningUncertainty.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';

interface Params {
	record: PlanningRecord;
	work: PlanningWork;
}

/** One evidence selection for packet construction and prerequisite eligibility; incomplete rows remain obligations. */
export const selectPlanningEvidence = ({ record, work }: Params): PlanningEvidence[] => {
	const claims = selectPlanningClaims({ record, work });
	const ids = new Set(claims.flatMap((claim) => [claim.id, ...claim.dependencies]));
	return record.evidence.filter(
		(item) =>
			(work.scope.kind === PlanningVocabulary.Scope.WholePlan && (item.conclusion !== '' || hasPlanningUncertainty({ evidence: item }))) ||
			item.assignmentId === work.id ||
			ids.has(item.id) ||
			item.dependencies.some((dependency) => ids.has(dependency.id)) ||
			item.claimIds.some((id) => ids.has(id)),
	);
};

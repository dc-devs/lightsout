import { PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { planningScopesIntersect } from '#src/plan/workflow/common/utils/planningScopesIntersect.ts';
import { selectPlanningEvidence } from '#src/plan/workflow/common/utils/selectPlanningEvidence.ts';
import { getCurrentPlanningReviews, planningFindingSettlement } from '#src/plan/workflow/review/index.ts';

interface Params {
	snapshot: PlanningSnapshot;
	stage?: PlanningWork['stage'];
}

/** Choose one prerequisite-ready obligation, prioritizing diagnosis and repairs before dependent authoring. */
export const selectPlanningWork = ({ snapshot, stage }: Params): { work: PlanningWork[]; reason: string } => {
	const record = snapshot.record;
	const ready = record.work.filter((work) => {
		if (stage !== undefined && work.stage !== stage) return false;
		if (work.status === PlanningVocabulary.WorkState.Complete || work.status === PlanningVocabulary.WorkState.Interrupted) return false;
		if (!work.prerequisiteIds.every((id) => record.work.some((item) => item.id === id && item.status === PlanningVocabulary.WorkState.Complete))) return false;
		if (
			work.role !== PlanningVocabulary.Role.Investigate &&
			work.role !== PlanningVocabulary.Role.Diagnose &&
			selectPlanningEvidence({ record, work }).some((evidence) => !evidence.complete)
		)
			return false;
		if (work.role !== PlanningVocabulary.Role.Draft) return true;
		if (record.work.some((item) => item.id.startsWith('assurance:') && item.stage === work.stage && item.status !== PlanningVocabulary.WorkState.Complete))
			return false;
		const reviews = getCurrentPlanningReviews({ snapshot, stage: work.stage });
		const challenge = reviews.some(
			(receipt) =>
				receipt.role === PlanningVocabulary.Role.DesignReview &&
				receipt.coverage.outcome === PlanningVocabulary.Review.Adequate &&
				record.work.some(
					(owner) =>
						owner.id === receipt.workId &&
						owner.status === PlanningVocabulary.WorkState.Complete &&
						owner.stage === work.stage &&
						owner.currentAttemptId === receipt.attemptId &&
						(owner.scope.kind === PlanningVocabulary.Scope.WholePlan ||
							(work.scope.kind === PlanningVocabulary.Scope.Selected &&
								work.scope.claimIds.every((id) => receipt.coverage.claimIds.includes(id)) &&
								work.scope.phaseIds.every((id) => receipt.coverage.phaseIds.includes(id)) &&
								work.scope.packageRoots.every((root) =>
									owner.scope.packageRoots.some((covered) => covered === '.' || root === covered || root.startsWith(`${covered}/`)),
								))),
				),
		);
		const blockers = record.findings.some(
			(finding) =>
				finding.severity === PlanningVocabulary.Severity.Blocking &&
				!planningFindingSettlement({ snapshot, finding, reviews }) &&
				!record.work.some((item) => item.id === work.id && item.failureIds.includes(finding.id)) &&
				planningScopesIntersect({ left: finding.scope, right: work.scope }),
		);
		return challenge && !blockers;
	});
	const priority = ({ work }: { work: PlanningWork }) =>
		[
			PlanningVocabulary.Role.Diagnose,
			PlanningVocabulary.Role.Adjudicate,
			PlanningVocabulary.Role.Repair,
			PlanningVocabulary.Role.Investigate,
			PlanningVocabulary.Role.Architect,
			PlanningVocabulary.Role.DesignReview,
			PlanningVocabulary.Role.Draft,
			PlanningVocabulary.Role.ImplementationReview,
			PlanningVocabulary.Role.IntegrationReview,
		].findIndex((role) => role === work.role);
	ready.sort((left, right) => priority({ work: left }) - priority({ work: right }));
	return {
		work: ready.slice(0, 1),
		reason:
			ready.length > 0
				? 'Selected prerequisite-ready current work with exclusive canonical publication.'
				: 'No current prerequisite-ready obligation is available.',
	};
};

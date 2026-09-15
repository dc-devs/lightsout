import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningGraphContext } from '#src/plan/workflow/store/common/types/PlanningGraphContext.ts';
import { planningResultReceiptPath } from '#src/plan/workflow/store/common/utils/planningResultReceiptPath.ts';
import { checkPlanningCycles } from '#src/plan/workflow/store/common/validation/checkPlanningCycles.ts';
import { requirePlanningIds } from '#src/plan/workflow/store/common/validation/requirePlanningIds.ts';

/** Validate work ownership, phase sequencing and independent review references. */
export const validatePlanningWork = ({ record, issues, work, findings, receipts }: PlanningGraphContext): void => {
	const artifacts = new Set(record.artifacts.map((artifact) => artifact.path));
	for (const item of record.work) {
		requirePlanningIds({ values: [...item.failureIds, ...item.diagnosisIds], available: findings, at: `${item.id}.diagnostics`, issues });
		if (item.status === PlanningVocabulary.WorkState.Running && item.currentAttemptId === undefined)
			issues.push({ at: item.id, message: 'Running work requires an active attempt' });
		requirePlanningIds({ values: item.prerequisiteIds, available: work, at: `${item.id}.prerequisites`, issues });
		if (item.status === PlanningVocabulary.WorkState.Complete && (item.currentAttemptId === undefined || item.resultReceiptId === undefined))
			issues.push({ at: item.id, message: 'Completed work requires an accepted attempt and result receipt' });
		if (item.resultReceiptId !== undefined && !artifacts.has(planningResultReceiptPath({ id: item.resultReceiptId })))
			issues.push({ at: item.id, message: 'Accepted result receipt artifact is missing' });
	}
	for (const receipt of record.reviewReceipts) {
		requirePlanningIds({ values: receipt.coverage.claimIds, available: new Set(record.claims.map((claim) => claim.id)), at: `${receipt.id}.coverage`, issues });
		requirePlanningIds({
			values: receipt.coverage.phaseIds,
			available: new Set(record.artifacts.flatMap((artifact) => (artifact.phaseId === undefined ? [] : [artifact.phaseId]))),
			at: `${receipt.id}.coverage`,
			issues,
		});
		requirePlanningIds({ values: [receipt.workId], available: work, at: receipt.id, issues });
		requirePlanningIds({
			values: [...receipt.findingIds, ...receipt.verifiedFindings.map((finding) => finding.findingId)],
			available: findings,
			at: receipt.id,
			issues,
		});
		const owner = record.work.find((item) => item.id === receipt.workId);
		if (
			owner?.role !== receipt.role ||
			![PlanningVocabulary.Role.DesignReview, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview].some(
				(role) => role === receipt.role,
			)
		)
			issues.push({ at: receipt.id, message: 'Independent review receipt has an invalid role owner' });
	}
	for (const finding of record.findings) {
		requirePlanningIds({
			values: finding.resolutionClaimIds,
			available: new Set(record.claims.map((claim) => claim.id)),
			at: `${finding.id}.resolution`,
			issues,
		});
		requirePlanningIds({ values: finding.resolutionArtifacts, available: artifacts, at: `${finding.id}.resolution`, issues });
		requirePlanningIds({ values: finding.verificationReceiptIds, available: receipts, at: finding.id, issues });
		if (finding.state === PlanningVocabulary.FindingState.Withdrawn && finding.citations.length === 0)
			issues.push({ at: finding.id, message: 'Withdrawal requires evidence' });
		if (
			finding.state === PlanningVocabulary.FindingState.Verified &&
			!record.reviewReceipts.some(
				(receipt) => finding.verificationReceiptIds.includes(receipt.id) && receipt.verifiedFindings.some((verified) => verified.findingId === finding.id),
			)
		)
			issues.push({ at: finding.id, message: 'Verified finding requires matching independent verification' });
	}
	checkPlanningCycles({ edges: new Map(record.work.map((item) => [item.id, item.prerequisiteIds])), at: 'work.prerequisites', issues });
	checkPlanningCycles({
		edges: new Map(record.artifacts.filter((artifact) => artifact.phaseId !== undefined).map((artifact) => [artifact.phaseId ?? '', artifact.prerequisiteIds])),
		at: 'phases.prerequisites',
		issues,
	});
};

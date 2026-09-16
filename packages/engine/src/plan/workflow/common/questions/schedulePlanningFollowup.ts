import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRecord, type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { resolvePlanningFindings } from '#src/plan/workflow/common/review/resolvePlanningFindings.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';

interface Params {
	record: PlanningRecord;
	artifacts: Map<string, string>;
	result: PlanningRoleResult;
}

/** Persist explicit dispute requests and connected followup work without losing any prior observation. */
export const schedulePlanningFollowup = ({ record, artifacts, result }: Params): void => {
	const resolved = resolvePlanningFindings({ snapshot: { record, artifacts, digest: record.parentDigest ?? result.inputDigest }, proposals: result });
	record.findings = resolved.findings;
	record.work.push(...resolved.work);
	const disputes = 'adjudicationRequests' in result ? (result.adjudicationRequests ?? []) : [];
	for (const [index, request] of disputes.entries()) {
		const workId = `followup:${result.attemptId}:adjudicate:${index}`;
		attachPlanningData({ record, artifacts, path: `planning-adjudication-requests/${sha256({ content: workId })}.json`, value: { workId, request } });
	}
	if (result.role === PlanningVocabulary.Role.Diagnose && 'diagnosis' in result) {
		for (const failed of record.work.filter((work) => work.status === PlanningVocabulary.WorkState.Interrupted && work.failureIds.length > 0)) {
			failed.status = PlanningVocabulary.WorkState.Pending;
			failed.diagnosisIds = [...new Set([...failed.diagnosisIds, ...failed.failureIds])];
			for (const finding of record.findings.filter((finding) => failed.failureIds.includes(finding.id))) finding.proposedResolution = result.diagnosis;
		}
	}
};

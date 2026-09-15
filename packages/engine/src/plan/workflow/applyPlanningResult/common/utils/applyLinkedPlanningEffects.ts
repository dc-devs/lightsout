import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { PlanningClaim, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningAcceptance } from '#src/plan/workflow/applyPlanningResult/common/types/PlanningAcceptance.ts';
import { hasPlanningUncertainty } from '#src/plan/workflow/common/evidence/hasPlanningUncertainty.ts';
import { normalizePlanningUnknownEvidence } from '#src/plan/workflow/common/evidence/normalizePlanningUnknownEvidence.ts';
import { applyPlanningArtifacts } from '#src/plan/workflow/common/runtime/applyPlanningArtifacts.ts';
import { applyPlanningReview } from '#src/plan/workflow/common/runtime/applyPlanningReview.ts';
import { composePlanningViews } from '#src/plan/workflow/common/runtime/composePlanningViews.ts';
import { schedulePlanningFollowup } from '#src/plan/workflow/common/runtime/schedulePlanningFollowup.ts';
import { validatePlanningCitations } from '#src/plan/workflow/common/runtime/validatePlanningCitations.ts';

/** Apply linked semantic effects only after the invocation's entire input basis passes validation. */
export const applyLinkedPlanningEffects = async ({
	runtime,
	current,
	record,
	artifacts,
	result,
	mapped,
	work,
	invocation,
	observations,
}: PlanningAcceptance): Promise<void> => {
	if ('claims' in mapped)
		for (const claim of mapped.claims) {
			record.claims = [...record.claims.filter((item) => item.id !== claim.id), PlanningClaim.parse(claim)];
		}

	for (const observation of observations) {
		for (const evidence of record.evidence)
			if (
				!evidence.complete &&
				evidence.conclusion === '' &&
				!hasPlanningUncertainty({ evidence }) &&
				evidence.acquisition === observation.evidence.acquisition &&
				evidence.assignmentId === observation.evidence.assignmentId
			)
				Object.assign(evidence, { ...observation.evidence, id: evidence.id });
		if (!record.evidence.some((item) => item.id === observation.evidence.id)) record.evidence.push(observation.evidence);
	}
	if ('evidence' in mapped)
		for (const evidence of mapped.evidence) {
			if (
				evidence.dependencies.some(
					(dependency) => !invocation.dependencies.some((known) => canonicalJson({ value: known }) === canonicalJson({ value: dependency })),
				)
			)
				throw new Error('A semantic conclusion claims unacquired evidence');
			record.evidence = [...record.evidence.filter((item) => item.id !== evidence.id), await normalizePlanningUnknownEvidence({ cwd: runtime.cwd, evidence })];
		}
	if (mapped.role === PlanningVocabulary.Role.Investigate && record.evidence.some((evidence) => evidence.assignmentId === mapped.workId && !evidence.complete))
		throw new Error('Investigation must resolve its explicitly stale semantic conclusions before completing');
	if ('findings' in mapped) record.findings.push(...mapped.findings);
	if ('work' in mapped) record.work.push(...mapped.work);
	applyPlanningArtifacts({ record, artifacts, result: mapped });
	await applyPlanningReview({ runtime, previous: current, record, result: mapped, invocation, artifacts });
	if ('adjudicationRequests' in mapped)
		for (const request of mapped.adjudicationRequests ?? [])
			await validatePlanningCitations({ cwd: runtime.cwd, snapshot: current, dependencies: invocation.dependencies, citations: request.citations });
	const rendered = composePlanningViews({
		runtime,
		previous: current,
		record,
		artifacts,
		authoring: mapped.role === PlanningVocabulary.Role.Draft || mapped.role === PlanningVocabulary.Role.Repair,
	});
	for (const [path, content] of rendered) artifacts.set(path, content);
	const completed = record.work.find((item) => item.id === work.id);
	if (!completed) throw new Error('Accepted work disappeared');
	completed.status = PlanningVocabulary.WorkState.Complete;
	completed.resultReceiptId = `result:${result.attemptId}`;
	schedulePlanningFollowup({ record, artifacts, result: mapped });
};

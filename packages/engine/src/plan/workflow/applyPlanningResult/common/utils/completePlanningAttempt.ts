import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningAcceptance } from '#src/plan/workflow/applyPlanningResult/common/types/PlanningAcceptance.ts';
import { invalidateAcceptedPlanningEffects } from '#src/plan/workflow/applyPlanningResult/common/utils/invalidateAcceptedPlanningEffects.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { buildPlanningInvocationPacket } from '#src/plan/workflow/common/runtime/buildPlanningInvocationPacket.ts';
import { planningSemanticBasis } from '#src/plan/workflow/common/runtime/planningSemanticBasis.ts';
import { type PlanningResultReceipt, planningResultReceiptPath } from '#src/plan/workflow/store/index.ts';

/** Preserve result provenance, output lineage and the permanent post-effect input basis in the same candidate. */
export const completePlanningAttempt = async ({
	runtime,
	current,
	record,
	artifacts,
	result,
	mapped,
	work: priorWork,
	invocation,
	observations,
	standards,
}: PlanningAcceptance): Promise<void> => {
	const work = record.work.find((item) => item.id === priorWork.id);
	if (!work?.resultReceiptId) throw new Error('Accepted work requires its result receipt');
	const receipt: PlanningResultReceipt = {
		id: work.resultReceiptId,
		workId: work.id,
		attemptId: result.attemptId,
		role: result.role,
		inputDigest: result.inputDigest,
		resultDigest: sha256({ content: canonicalJson({ value: result }) }),
		acceptedFromDigest: current.digest,
		acceptedRevision: current.record.revision + 1,
		effects: {
			claimIds: 'claims' in mapped ? mapped.claims.map((claim) => claim.id) : [],
			evidenceIds: [...observations.map((item) => item.evidence.id), ...('evidence' in mapped ? mapped.evidence.map((item) => item.id) : [])],
			findingIds: 'findings' in mapped ? mapped.findings.map((finding) => finding.id) : [],
			reviewReceiptIds: record.reviewReceipts.filter((review) => review.attemptId === result.attemptId).map((review) => review.id),
			artifacts: record.artifacts
				.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data && current.artifacts.get(artifact.path) !== artifacts.get(artifact.path))
				.map(({ path, sha256 }) => ({ path, sha256 })),
		},
	};
	attachPlanningData({ record, artifacts, path: planningResultReceiptPath({ id: receipt.id }), value: receipt });
	for (const failure of record.findings.filter((finding) => work.failureIds.includes(finding.id))) {
		failure.state = PlanningVocabulary.FindingState.Withdrawn;
		failure.proposedResolution = 'The preserved failed operation completed successfully on this recorded retry.';
		const path = planningResultReceiptPath({ id: receipt.id });
		const content = artifacts.get(path);
		if (content === undefined) throw new Error('Accepted result receipt bytes are missing');
		failure.citations = [...failure.citations, { artifact: path, quote: receipt.attemptId, sha256: sha256({ content }) }];
	}
	invalidateAcceptedPlanningEffects({ runtime, current, record, artifacts, work, receipt });
	const after = { ...current, record, artifacts };
	const inputBasis = planningSemanticBasis({
		record: current.record,
		work,
		outputClaimIds: receipt.effects.claimIds,
		outputEvidenceIds: receipt.effects.evidenceIds,
		outputPaths: [
			...receipt.effects.artifacts.map((artifact) => artifact.path),
			...('artifactLayouts' in mapped ? (mapped.artifactLayouts ?? []).map((layout) => layout.path) : []),
		],
	});
	const semanticBasis = planningSemanticBasis({ record, work, seed: inputBasis });
	const baseline = await buildPlanningInvocationPacket({ runtime, snapshot: after, work, standards, observationPaths: invocation.observationPaths });
	attachPlanningData({
		record,
		artifacts,
		path: `planning-baselines/${sha256({ content: receipt.id })}.json`,
		value: {
			format: 'planning-baseline-v1',
			workId: work.id,
			attemptId: result.attemptId,
			resultReceiptId: receipt.id,
			acceptedRevision: receipt.acceptedRevision,
			packetDigest: baseline.inputDigest,
			invocationPolicyDigest: invocation.invocationPolicyDigest,
			executionPolicyDigest: invocation.executionPolicyDigest,
			observationPaths: invocation.observationPaths,
			dependencies: baseline.dependencies,
			semanticBasis,
		},
	});
};

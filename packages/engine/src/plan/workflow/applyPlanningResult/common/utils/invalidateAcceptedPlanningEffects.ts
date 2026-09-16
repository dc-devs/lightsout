import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningAcceptance } from '#src/plan/workflow/applyPlanningResult/common/types/PlanningAcceptance.ts';
import { applyPlanningInvalidation } from '#src/plan/workflow/common/utils/applyPlanningInvalidation.ts';
import type { PlanningResultReceipt } from '#src/plan/workflow/store/index.ts';

interface Params extends Pick<PlanningAcceptance, 'runtime' | 'current' | 'record' | 'artifacts' | 'work'> {
	receipt: PlanningResultReceipt;
}

/** The policy receives exact semantic deltas; unrelated saved work remains reusable. */
export const invalidateAcceptedPlanningEffects = ({ runtime, current, record, artifacts, work, receipt }: Params): void => {
	const removed = current.record.artifacts
		.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data && !record.artifacts.some((item) => item.path === artifact.path))
		.map((artifact) => artifact.path);
	const delta = {
		sourceChanged: canonicalJson({ value: current.record.sources }) !== canonicalJson({ value: record.sources }),
		claimIds: receipt.effects.claimIds,
		evidenceIds: record.evidence
			.filter((item) => canonicalJson({ value: item }) !== canonicalJson({ value: current.record.evidence.find((previous) => previous.id === item.id) }))
			.map((item) => item.id),
		artifactPaths: [...removed, ...receipt.effects.artifacts.map((artifact) => artifact.path)],
		boundaryPaths: [
			...removed,
			...record.artifacts
				.filter(
					(artifact) =>
						artifact.variant !== PlanningVocabulary.Artifact.Data &&
						(() => {
							const prior = current.record.artifacts.find((item) => item.path === artifact.path);
							const { sha256: _sha, ...layout } = artifact;
							if (!prior) return true;
							const { sha256: _oldSha, ...previous } = prior;
							return canonicalJson({ value: layout }) !== canonicalJson({ value: previous });
						})(),
				)
				.map((artifact) => artifact.path),
		],
		findingIds: record.findings
			.filter((finding) => canonicalJson({ value: finding }) !== canonicalJson({ value: current.record.findings.find((item) => item.id === finding.id) }))
			.map((finding) => finding.id),
		reviewReceiptIds: receipt.effects.reviewReceiptIds,
		authorWorkId: work.id,
	};
	const invalidation = runtime.services.invalidate({
		snapshot: { ...current, record, artifacts },
		changedDependencies: [],
		changedClaimIds: delta.claimIds,
		delta,
	});
	applyPlanningInvalidation({ record, invalidation, authorWorkId: work.id });
};

import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRecord, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { hasPlanningUncertainty } from '#src/plan/workflow/common/evidence/hasPlanningUncertainty.ts';
import type { PlanningSemanticBasis } from '#src/plan/workflow/common/types/PlanningSemanticBasis.ts';
import { planningScopesIntersect } from '#src/plan/workflow/common/utils/planningScopesIntersect.ts';
import { selectPlanningArtifacts } from '#src/plan/workflow/common/utils/selectPlanningArtifacts.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';

interface Params {
	record: PlanningRecord;
	work: PlanningWork;
	seed?: PlanningSemanticBasis;
	outputClaimIds?: string[];
	outputEvidenceIds?: string[];
	outputPaths?: string[];
}

const projectInputs = ({
	record,
	work,
	design,
	evidenceIds,
	artifactPaths,
	findingIds,
}: Pick<Params, 'record' | 'work'> & { design: boolean; evidenceIds: string[]; artifactPaths: string[]; findingIds: string[] }) => {
	const evidence = evidenceIds.map((id) => record.evidence.find((item) => item.id === id) ?? { missing: id });
	const artifacts = artifactPaths.map((path) => {
		const artifact = record.artifacts.find((item) => item.path === path);
		if (!artifact) return { missing: path };
		const { sha256: _bytes, ...layout } = artifact;
		return design || work.role === PlanningVocabulary.Role.Architect ? layout : artifact;
	});
	const findings = findingIds.map((id) => {
		const finding = record.findings.find((item) => item.id === id);
		if (!finding) return { missing: id };
		const { verificationReceiptIds: _receipts, state, ...meaning } = finding;
		return { ...meaning, state: state === PlanningVocabulary.FindingState.Verified ? PlanningVocabulary.FindingState.Repairing : state };
	});
	const reviews =
		work.role === PlanningVocabulary.Role.IntegrationReview
			? record.reviewReceipts.filter(
					(receipt) =>
						receipt.role !== PlanningVocabulary.Role.IntegrationReview &&
						record.work.some(
							(owner) =>
								owner.id === receipt.workId &&
								owner.resultReceiptId &&
								owner.currentAttemptId === receipt.attemptId &&
								owner.status === PlanningVocabulary.WorkState.Complete,
						),
				)
			: [];
	return { evidence, artifacts, findings, reviews };
};

/** Permanent inputs are role-specific: authorized descendant output changes require assurance, not automatic re-authoring. */
export const planningSemanticBasis = ({ record, work, seed, outputClaimIds = [], outputEvidenceIds = [], outputPaths = [] }: Params): PlanningSemanticBasis => {
	const review = [PlanningVocabulary.Role.DesignReview, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview].some(
		(role) => work.role === role,
	);
	const design = work.role === PlanningVocabulary.Role.DesignReview;
	const relevant = selectPlanningClaims({ record, work }).filter(
		(claim) =>
			!design ||
			claim.owner === PlanningVocabulary.Owner.User ||
			[
				PlanningVocabulary.ClaimKind.Architecture,
				PlanningVocabulary.ClaimKind.Contract,
				PlanningVocabulary.ClaimKind.Constraint,
				PlanningVocabulary.ClaimKind.Requirement,
			].some((kind) => claim.kind === kind),
	);
	const claimIds = seed && !review ? seed.claimIds : relevant.filter((claim) => !outputClaimIds.includes(claim.id)).map((claim) => claim.id);
	const artifactPaths =
		seed && !review
			? seed.artifactPaths
			: work.role === PlanningVocabulary.Role.Investigate
				? []
				: selectPlanningArtifacts({ record, scope: work.scope, claimIds })
						.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data && !outputPaths.includes(artifact.path))
						.map((artifact) => artifact.path);
	const findingIds =
		seed && !review
			? seed.findingIds
			: record.findings
					.filter(
						(finding) =>
							planningScopesIntersect({ left: work.scope, right: finding.scope }) &&
							(!design ||
								record.reviewReceipts.some((receipt) => receipt.role === PlanningVocabulary.Role.DesignReview && receipt.findingIds.includes(finding.id))),
					)
					.map((finding) => finding.id);
	const claims = claimIds.map((id) => record.claims.find((claim) => claim.id === id) ?? { missing: id });
	const selectedIds = new Set(relevant.flatMap((claim) => [claim.id, ...claim.dependencies]));
	const evidenceIds =
		seed && !review
			? seed.evidenceIds
			: record.evidence
					.filter(
						(item) =>
							!outputEvidenceIds.includes(item.id) &&
							((work.scope.kind === PlanningVocabulary.Scope.WholePlan && (item.conclusion !== '' || hasPlanningUncertainty({ evidence: item }))) ||
								item.assignmentId === work.id ||
								selectedIds.has(item.id) ||
								item.dependencies.some((dependency) => selectedIds.has(dependency.id)) ||
								item.claimIds.some((id) => selectedIds.has(id))),
					)
					.map((item) => item.id);
	const { evidence, artifacts, findings, reviews } = projectInputs({ record, work, design, evidenceIds, artifactPaths, findingIds });

	return {
		claimIds,
		evidenceIds,
		artifactPaths,
		findingIds,
		digest: sha256({
			content: canonicalJson({
				value: {
					role: work.role,
					stage: work.stage,
					scope: work.scope,
					assignment: work.assignment,
					claims,
					evidence,
					artifacts,
					findings,
					standards: record.standards,
					reviews,
				},
			}),
		}),
	};
};

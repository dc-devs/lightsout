import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningReviewReceipt, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { planningSemanticBasis } from '#src/plan/workflow/common/runtime/planningSemanticBasis.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/PlanningBaseline.ts';
import { PlanningInvocation } from '#src/plan/workflow/common/types/PlanningInvocation.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { selectPlanningArtifacts } from '#src/plan/workflow/common/utils/selectPlanningArtifacts.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';
import { PlanningResultReceipt, planningResultReceiptPath } from '#src/plan/workflow/store/index.ts';

interface Params {
	snapshot: PlanningSnapshot;
	stage?: PlanningWork['stage'];
}

const inputsIntact = ({ snapshot, work, baseline }: { snapshot: PlanningSnapshot; work: PlanningWork; baseline: PlanningBaseline }): boolean => {
	if (planningSemanticBasis({ record: snapshot.record, work, seed: baseline.semanticBasis }).digest !== baseline.semanticBasis.digest) return false;
	for (const path of baseline.semanticBasis.artifactPaths) {
		const artifact = snapshot.record.artifacts.find((item) => item.path === path);
		const content = snapshot.artifacts.get(path);
		if (!artifact || content === undefined || sha256({ content }) !== artifact.sha256) return false;
	}
	return snapshot.record.sources.every((source) => {
		const path = `planning-originals/${source.sha256}.txt`;
		const descriptor = snapshot.record.artifacts.find((artifact) => artifact.path === path);
		return source.sha256 === sha256({ content: source.text }) && descriptor?.sha256 === source.sha256 && snapshot.artifacts.get(path) === source.text;
	});
};

const assigned = ({ snapshot, work, receipt }: { snapshot: PlanningSnapshot; work: PlanningWork; receipt: PlanningReviewReceipt }): boolean => {
	const claims = selectPlanningClaims({ record: snapshot.record, work });
	const artifacts = selectPlanningArtifacts({ record: snapshot.record, scope: work.scope, claimIds: claims.map((claim) => claim.id) }).filter(
		(artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data,
	);
	const claimIds = new Set(claims.map((claim) => claim.id));
	const phases = new Set(artifacts.flatMap((artifact) => (artifact.phaseId ? [artifact.phaseId] : [])));
	const sources = new Set(
		work.scope.kind === PlanningVocabulary.Scope.WholePlan
			? snapshot.record.sources.map((source) => source.sha256)
			: claims.map((claim) => claim.origin.sha256),
	);
	return (
		receipt.coverage.claimIds.every((id) => claimIds.has(id)) &&
		receipt.coverage.phaseIds.every((id) => phases.has(id)) &&
		(receipt.coverage.sourceDigests ?? []).every((digest) => sources.has(digest)) &&
		(receipt.coverage.artifactPaths ?? []).every((path) => artifacts.some((artifact) => artifact.path === path))
	);
};

const authorsPrecedeReview = ({
	receipt,
	result,
	results,
	invocations,
}: {
	receipt: PlanningReviewReceipt;
	result: PlanningResultReceipt;
	results: PlanningResultReceipt[];
	invocations: PlanningInvocation[];
}) => {
	return receipt.authorAttemptIds.every((attemptId) =>
		results.some(
			(author) =>
				author.attemptId === attemptId &&
				author.acceptedRevision < result.acceptedRevision &&
				[PlanningVocabulary.Role.Architect, PlanningVocabulary.Role.Draft, PlanningVocabulary.Role.Repair].some((role) => role === author.role) &&
				invocations.some(
					(binding) =>
						binding.attemptId === author.attemptId &&
						binding.workId === author.workId &&
						binding.inputDigest === author.inputDigest &&
						binding.role === author.role,
				),
		),
	);
};

const currentCandidates = ({ snapshot, stage }: { snapshot: PlanningSnapshot; stage: PlanningWork['stage'] | undefined }) => {
	const candidates: Array<{ receipt: PlanningReviewReceipt; work: PlanningWork; baseline: PlanningBaseline }> = [];
	for (const candidate of snapshot.record.reviewReceipts) {
		const parsed = PlanningReviewReceipt.safeParse(candidate);
		if (!parsed.success) continue;
		const receipt = parsed.data;
		const work = snapshot.record.work.find((item) => item.id === receipt.workId);
		if (
			!work ||
			(stage !== undefined && work.stage !== stage) ||
			work.status !== PlanningVocabulary.WorkState.Complete ||
			work.currentAttemptId !== receipt.attemptId ||
			work.role !== receipt.role ||
			work.inputDigest !== receipt.inputDigest
		)
			continue;
		if (!work.resultReceiptId) continue;
		const baseline = readPlanningProof({ snapshot, path: `planning-baselines/${sha256({ content: work.resultReceiptId })}.json`, schema: PlanningBaseline });
		if (
			!baseline ||
			baseline.workId !== work.id ||
			baseline.attemptId !== receipt.attemptId ||
			baseline.resultReceiptId !== work.resultReceiptId ||
			!assigned({ snapshot, work, receipt }) ||
			!inputsIntact({ snapshot, work, baseline })
		)
			continue;
		candidates.push({ receipt, work, baseline });
	}
	return candidates;
};

/** Current review authority requires its actual accepted result, immutable invocation and unchanged semantic baseline. */
export const getCurrentPlanningReviews = ({ snapshot, stage }: Params): PlanningReviewReceipt[] => {
	// Retired or semantically stale work cannot authorize a review. Screen it before reading historical author proofs.
	const candidates = currentCandidates({ snapshot, stage });
	if (candidates.length === 0) return [];
	const results = snapshot.record.artifacts
		.filter((artifact) => artifact.path.startsWith('planning-results/'))
		.flatMap((artifact) => {
			const result = readPlanningProof({ snapshot, path: artifact.path, schema: PlanningResultReceipt });
			return result &&
				result.acceptedRevision > 0 &&
				result.acceptedRevision <= snapshot.record.revision &&
				planningResultReceiptPath({ id: result.id }) === artifact.path
				? [result]
				: [];
		});
	const invocations = snapshot.record.artifacts
		.filter((artifact) => artifact.path.startsWith('planning-invocations/'))
		.flatMap((artifact) => {
			const invocation = readPlanningProof({ snapshot, path: artifact.path, schema: PlanningInvocation });
			return invocation && artifact.path === `planning-invocations/${sha256({ content: invocation.id })}.json` ? [invocation] : [];
		});
	const eligible: PlanningReviewReceipt[] = [];
	for (const { receipt, work, baseline } of candidates) {
		const result = results.find((item) => item.id === work.resultReceiptId);
		const invocation = invocations.find((item) => item.id === receipt.issuer.invocationId);
		if (
			!result ||
			!invocation ||
			result.workId !== work.id ||
			result.attemptId !== receipt.attemptId ||
			result.role !== receipt.role ||
			result.inputDigest !== receipt.inputDigest ||
			!result.effects.reviewReceiptIds.includes(receipt.id) ||
			invocation.workId !== work.id ||
			invocation.attemptId !== receipt.attemptId ||
			invocation.role !== receipt.role ||
			invocation.stage !== work.stage ||
			invocation.inputDigest !== work.inputDigest ||
			canonicalJson({ value: invocation.dependencies }) !== canonicalJson({ value: receipt.dependencies })
		)
			continue;
		if (baseline.acceptedRevision !== result.acceptedRevision || baseline.invocationPolicyDigest !== invocation.invocationPolicyDigest) continue;
		const authorsExist = authorsPrecedeReview({ receipt, result, results, invocations });
		if (!authorsExist) continue;
		eligible.push(receipt);
	}
	return eligible;
};

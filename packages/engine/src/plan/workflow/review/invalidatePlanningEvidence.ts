import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningDependency, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningSemanticBasis } from '#src/plan/workflow/common/runtime/planningSemanticBasis.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/PlanningBaseline.ts';
import type { PlanningSemanticDelta } from '#src/plan/workflow/common/types/PlanningSemanticDelta.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { planningScopesIntersect } from '#src/plan/workflow/common/utils/planningScopesIntersect.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { planningFindingSettlement } from '#src/plan/workflow/review/common/utils/planningFindingSettlement.ts';

interface Params {
	snapshot: PlanningSnapshot;
	changedDependencies: PlanningDependency[];
	changedClaimIds: string[];
	delta?: PlanningSemanticDelta;
}

const affectedMeaning = ({ snapshot, changedClaimIds, changedDependencies, delta }: Params) => {
	const record = snapshot.record;
	const ids = new Set([...changedClaimIds, ...(delta?.claimIds ?? []), ...(delta?.evidenceIds ?? [])]);
	for (const evidence of record.evidence)
		if (evidence.dependencies.some((dependency) => changedDependencies.some((changed) => changed.id === dependency.id))) ids.add(evidence.id);
	// A visited-set closure treats mutually dependent semantic claims as one component without imposing an execution order on them.
	let changed = true;
	while (changed) {
		changed = false;
		for (const claim of record.claims)
			if (!ids.has(claim.id) && claim.dependencies.some((id) => ids.has(id))) {
				ids.add(claim.id);
				changed = true;
			}
	}
	const paths = new Set([...(delta?.artifactPaths ?? []), ...(delta?.boundaryPaths ?? [])]);
	const claims = record.claims.filter((claim) => ids.has(claim.id));
	const scopes = [
		...claims.map((claim) => claim.scope),
		...record.artifacts.filter((artifact) => paths.has(artifact.path)).map((artifact) => artifact.boundaries),
	];
	const baselineDependencies = record.artifacts
		.filter((artifact) => artifact.path.startsWith('planning-baselines/'))
		.flatMap((artifact) => readPlanningProof({ snapshot, path: artifact.path, schema: PlanningBaseline })?.dependencies ?? []);
	const wide =
		delta?.sourceChanged === true ||
		claims.some((claim) => claim.scope.kind === PlanningVocabulary.Scope.WholePlan) ||
		[...ids].some((id) => !record.claims.some((claim) => claim.id === id) && !record.evidence.some((evidence) => evidence.id === id)) ||
		changedDependencies.some(
			(dependency) =>
				dependency.kind === PlanningVocabulary.Dependency.Unknown ||
				dependency.kind === PlanningVocabulary.Dependency.Search ||
				dependency.kind === PlanningVocabulary.Dependency.Membership ||
				(dependency.kind === PlanningVocabulary.Dependency.Content && record.standards.some((standard) => standard.artifact === dependency.path)) ||
				!baselineDependencies.some((known) => known.id === dependency.id),
		);
	return { ids, paths, scopes, wide };
};

/** Retire connected semantic evidence; global, shared and uncertain changes widen review while diagnostic-only changes do nothing. */
export const invalidatePlanningEvidence = (params: Params): { workIds: string[]; receiptIds: string[]; reopenFindingIds: string[]; reason: string } => {
	const { snapshot, changedDependencies, changedClaimIds, delta } = params;
	const record = snapshot.record;
	const effects = affectedMeaning(params);
	const receiptIds = new Set<string>();
	const workIds = new Set<string>();
	const semanticChange =
		changedDependencies.length +
			changedClaimIds.length +
			(delta?.claimIds.length ?? 0) +
			(delta?.evidenceIds.length ?? 0) +
			(delta?.artifactPaths.length ?? 0) +
			(delta?.boundaryPaths.length ?? 0) +
			(delta?.findingIds.length ?? 0) >
			0 || delta?.sourceChanged === true;
	const detailedReviewChanged = record.reviewReceipts.some(
		(receipt) => delta?.reviewReceiptIds.includes(receipt.id) && receipt.role !== PlanningVocabulary.Role.IntegrationReview,
	);
	for (const work of record.work) {
		if (work.id === delta?.authorWorkId || work.role === PlanningVocabulary.Role.Diagnose || work.role === PlanningVocabulary.Role.Adjudicate) continue;
		const review = [PlanningVocabulary.Role.DesignReview, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview].some(
			(role) => role === work.role,
		);
		const baseline = work.resultReceiptId
			? readPlanningProof({ snapshot, path: `planning-baselines/${sha256({ content: work.resultReceiptId })}.json`, schema: PlanningBaseline })
			: undefined;
		const dependencyChanged = baseline?.dependencies.some((dependency) => changedDependencies.some((changed) => changed.id === dependency.id)) ?? false;
		const scoped = effects.scopes.some((scope) => planningScopesIntersect({ left: scope, right: work.scope }));
		const staleMeaning =
			baseline !== undefined && planningSemanticBasis({ record, work, seed: baseline.semanticBasis }).digest !== baseline.semanticBasis.digest;
		const relevant = semanticChange && (effects.wide || dependencyChanged || scoped || staleMeaning);
		// Author artifacts remain historical outputs for fresh challenge; changed findings are repaired rather than forcing a blanket rewrite.
		const retire = review
			? (work.role === PlanningVocabulary.Role.IntegrationReview && detailedReviewChanged) || relevant
			: work.role === PlanningVocabulary.Role.Investigate
				? dependencyChanged || (work.status === PlanningVocabulary.WorkState.Running && relevant) || (semanticChange && effects.wide && staleMeaning)
				: work.status === PlanningVocabulary.WorkState.Running && relevant;
		if (!retire) continue;
		if (
			work.role === PlanningVocabulary.Role.DesignReview &&
			!effects.wide &&
			!dependencyChanged &&
			!staleMeaning &&
			changedClaimIds.length === 0 &&
			(delta?.claimIds.length ?? 0) === 0
		)
			continue;
		workIds.add(work.id);
		for (const receipt of record.reviewReceipts.filter((receipt) => receipt.workId === work.id && receipt.attemptId === work.currentAttemptId))
			receiptIds.add(receipt.id);
	}
	const reopenFindingIds = record.findings
		.filter((finding) => {
			if (finding.state === PlanningVocabulary.FindingState.Verified) return finding.verificationReceiptIds.some((id) => receiptIds.has(id));
			if (finding.state !== PlanningVocabulary.FindingState.Withdrawn || !semanticChange) return false;
			const retry =
				finding.citations.some((citation) => citation.artifact.startsWith('planning-results/')) &&
				planningFindingSettlement({ snapshot, finding, reviews: [] });
			if (retry) return false;
			return (
				effects.wide ||
				effects.scopes.some((scope) => planningScopesIntersect({ left: scope, right: finding.scope })) ||
				finding.citations.some(
					(citation) =>
						effects.paths.has(citation.artifact) || changedDependencies.some((dependency) => 'path' in dependency && dependency.path === citation.artifact),
				)
			);
		})
		.map((finding) => finding.id);
	return {
		workIds: [...workIds],
		receiptIds: [...receiptIds],
		reopenFindingIds,
		reason: effects.wide
			? 'Global/shared or uncertain dependencies require wider current semantic review.'
			: canonicalJson({ value: { affectedClaims: [...effects.ids], paths: [...effects.paths], detailedReviewChanged } }),
	};
};

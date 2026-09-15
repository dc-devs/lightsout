import { messageOf } from '#src/common/utils/messageOf.ts';
import { FindingSeverity, PlanningReadiness, PlanningVocabulary, type StructuralFinding } from '#src/contracts/index.ts';
import { hasPlanningUncertainty } from '#src/plan/workflow/common/evidence/hasPlanningUncertainty.ts';
import type { PlanningAssuranceContext } from '#src/plan/workflow/common/types/PlanningAssuranceContext.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { renderPlanningContract, validatePlanningCoverage } from '#src/plan/workflow/draft/index.ts';
import { planningAssuranceReady } from '#src/plan/workflow/review/common/utils/planningAssuranceReady.ts';
import { planningFindingSettlement } from '#src/plan/workflow/review/common/utils/planningFindingSettlement.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/review/common/utils/planningIntegrationBasis.ts';
import { planningReviewObligations } from '#src/plan/workflow/review/common/utils/planningReviewObligations.ts';
import { resolvePlanningAlignment } from '#src/plan/workflow/review/resolvePlanningAlignment.ts';

interface Params {
	snapshot: PlanningSnapshot;
	structural: StructuralFinding[];
	dependenciesCurrent: boolean;
	stage: PlanningRuntime['stage'];
	assurance?: PlanningAssuranceContext;
}

/** Derive stage-specific completion from exact original obligations, current accepted independent evidence, and substantive closure. */
export const evaluatePlanningReadiness = ({ snapshot, structural, dependenciesCurrent, stage, assurance }: Params): PlanningReadiness => {
	const implementation = stage === PlanningVocabulary.Stage.Implementation;
	const readiness: PlanningReadiness = {
		target: implementation ? PlanningVocabulary.Target.Implementation : PlanningVocabulary.Target.Alignment,
		ready: false,
		generation: snapshot.digest,
		inputDigest: snapshot.digest,
		structuralFailures: structural.filter((finding) => finding.severity === FindingSeverity.Blocking).map((finding) => `${finding.phase}: ${finding.issue}`),
		uncoveredClaimIds: [],
		openBlockerIds: [],
		unresolvedQuestionIds: [],
	};
	try {
		readiness.inputDigest = planningIntegrationBasis({ snapshot });
		const obligations = planningReviewObligations({ snapshot, stage });
		const reasons: string[] = [];
		if (!dependenciesCurrent) reasons.push('Required dependencies have not been refreshed.');
		if (snapshot.record.sources.length === 0) reasons.push('Original binding intent is absent.');
		renderPlanningContract({ snapshot });
		readiness.uncoveredClaimIds = obligations.uncoveredClaimIds;
		readiness.unresolvedQuestionIds = snapshot.record.claims
			.filter((claim) => claim.state === PlanningVocabulary.ClaimState.Unresolved)
			.map((claim) => claim.id);
		readiness.openBlockerIds = snapshot.record.findings
			.filter(
				(finding) =>
					finding.severity === PlanningVocabulary.Severity.Blocking && !planningFindingSettlement({ snapshot, finding, reviews: obligations.receipts }),
			)
			.map((finding) => finding.id);
		if (!obligations.fullSources) reasons.push('The complete original design still requires current independent challenge.');
		if (!planningAssuranceReady({ snapshot, reviews: obligations.receipts, assurance, inputDigest: readiness.inputDigest }))
			reasons.push('Unknown dependency reach lacks current complete assurance.');
		if (snapshot.record.work.some((work) => work.stage === stage && work.status !== PlanningVocabulary.WorkState.Complete))
			reasons.push('Necessary planning work remains unfinished.');
		if (
			snapshot.record.evidence.some(
				(evidence) =>
					!evidence.complete &&
					(evidence.conclusion !== '' || hasPlanningUncertainty({ evidence }) || obligations.claims.some((claim) => claim.dependencies.includes(evidence.id))),
			)
		)
			reasons.push('Required investigation conclusions remain incomplete.');
		if (implementation) {
			if (!obligations.artifacts.some((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Overview))
				reasons.push('Concrete implementation deliverables are absent.');
			readiness.structuralFailures.push(
				...validatePlanningCoverage({ snapshot, artifacts: snapshot.artifacts }).map((finding) => `${finding.phase}: ${finding.issue}`),
			);
			if (obligations.uncoveredPaths.length > 0) reasons.push(`Concrete artifacts lack detailed coverage: ${obligations.uncoveredPaths.join(', ')}`);
			const integration = obligations.integration;
			if (integration) readiness.integrationReceiptId = integration.id;
			else reasons.push('A distinct final integration review must cover the current original intent, interfaces and detailed review proofs.');
		} else if (!resolvePlanningAlignment({ snapshot })) reasons.push('The challenged design requires explicit notes-bound approval and technical delegation.');
		readiness.ready =
			reasons.length === 0 &&
			readiness.structuralFailures.length === 0 &&
			readiness.uncoveredClaimIds.length === 0 &&
			readiness.openBlockerIds.length === 0 &&
			readiness.unresolvedQuestionIds.length === 0;
		if (!readiness.ready)
			readiness.missingReason = reasons.join(' ') || 'Current coverage, required decisions or independently verified repairs remain incomplete.';
	} catch (error) {
		readiness.missingReason = `Required planning evidence is invalid or unavailable: ${messageOf({ error })}`;
	}
	return PlanningReadiness.parse(readiness);
};

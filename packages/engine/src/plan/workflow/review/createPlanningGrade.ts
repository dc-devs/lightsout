import {
	FindingSeverity,
	GradeReport,
	GradeScope,
	PlanGrade,
	type PlanningReadiness,
	PlanningVocabulary,
	type StructuralFinding,
} from '#src/contracts/index.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/common/review/planningIntegrationBasis.ts';
import { planningReviewObligations } from '#src/plan/workflow/common/review/planningReviewObligations.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	readiness: PlanningReadiness;
	structural: StructuralFinding[];
}

/** Render the actual implementation predicate as a compatible grade without fictional lens runs or light-phase exemptions. */
export const createPlanningGrade = ({ snapshot, readiness, structural }: Params): GradeReport => {
	const obligations = planningReviewObligations({ snapshot, stage: PlanningVocabulary.Stage.Implementation });
	const complete =
		readiness.ready &&
		readiness.target === PlanningVocabulary.Target.Implementation &&
		readiness.generation === snapshot.digest &&
		readiness.inputDigest === planningIntegrationBasis({ snapshot }) &&
		structural.every((finding) => finding.severity !== FindingSeverity.Blocking) &&
		obligations.uncoveredClaimIds.length + obligations.uncoveredPaths.length === 0 &&
		obligations.fullSources !== undefined &&
		obligations.integration?.id === readiness.integrationReceiptId &&
		obligations.integration !== undefined;
	return GradeReport.parse({
		planName: snapshot.record.planName,
		grade: complete ? PlanGrade.A : PlanGrade.BelowA,
		structural,
		gaps: [],
		lenses: [],
		weights: [],
		phasesLight: [],
		phasesChecked: obligations.artifacts
			.filter(
				(artifact) =>
					artifact.variant !== PlanningVocabulary.Artifact.Overview &&
					obligations.detailed.some(
						(receipt) => receipt.coverage.artifactPaths?.includes(artifact.path) && (!artifact.phaseId || receipt.coverage.phaseIds.includes(artifact.phaseId)),
					),
			)
			.map((artifact) => artifact.path),
		complete,
		scopeComplete: complete,
		passed: complete,
		gradedAt: new Date().toISOString(),
		scope: GradeScope.Full,
		focusedOn: [],
		...(complete
			? {}
			: { incompleteReason: readiness.missingReason ?? 'Implementation readiness is incomplete; brainstorm alignment cannot authorize implementation.' }),
		workflow: {
			format: 'planning-grade-v1',
			generation: snapshot.digest,
			inputDigest: readiness.inputDigest,
			target: readiness.target,
			coverageReceiptIds: obligations.receipts.map((receipt) => receipt.id),
			...(readiness.integrationReceiptId ? { integrationReceiptId: readiness.integrationReceiptId } : {}),
			findings: snapshot.record.findings,
		},
	});
};

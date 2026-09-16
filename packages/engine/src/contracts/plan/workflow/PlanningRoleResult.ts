import { z } from 'zod';
import { PlanningCitation } from '#src/contracts/plan/workflow/common/types/PlanningCitation.ts';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningOrigin } from '#src/contracts/plan/workflow/common/types/PlanningOrigin.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningReviewCoverage } from '#src/contracts/plan/workflow/common/types/PlanningReviewCoverage.ts';
import { PlanningAdjudicationRequest } from '#src/contracts/plan/workflow/PlanningAdjudicationRequest.ts';
import { PlanningArtifactLayout } from '#src/contracts/plan/workflow/PlanningArtifactLayout.ts';
import { PlanningClaim } from '#src/contracts/plan/workflow/PlanningClaim.ts';
import { PlanningDependency } from '#src/contracts/plan/workflow/PlanningDependency.ts';
import { PlanningEvidence } from '#src/contracts/plan/workflow/PlanningEvidence.ts';
import { PlanningEvidenceRequest } from '#src/contracts/plan/workflow/PlanningEvidenceRequest.ts';
import { PlanningFinding } from '#src/contracts/plan/workflow/PlanningFinding.ts';
import { PlanningUnknownAssessment } from '#src/contracts/plan/workflow/PlanningUnknownAssessment.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';
import { PlanningWork } from '#src/contracts/plan/workflow/PlanningWork.ts';

const planningProposedClaim = z
	.union(
		PlanningClaim.options.map((variant) =>
			variant.extend({
				origin: z.union([PlanningOrigin, PlanningOrigin.omit({ text: true })]),
			}),
		),
	)
	.refine(
		(claim) =>
			claim.confirmationId === undefined &&
			claim.legacySettlementId === undefined &&
			!(claim.kind === PlanningVocabulary.ClaimKind.Question && claim.question.answerId !== undefined) &&
			!(claim.owner === PlanningVocabulary.Owner.User && claim.state === PlanningVocabulary.ClaimState.Settled),
		'Role proposals cannot settle user-owned claims or mint confirmations',
	);

const identity = {
	workId: z.string().min(1),
	attemptId: z.string().min(1),
	inputDigest: PlanningDigest,
	invocationId: z.string().min(1).optional(),
	packetDigest: PlanningDigest.optional(),
};
const terminal = z.object({ ...identity, kind: z.literal(PlanningVocabulary.ResultKind.Terminal), dependencies: z.array(PlanningDependency) });
const claims = z.array(planningProposedClaim);
const layouts = { artifactLayouts: z.array(PlanningArtifactLayout).optional() };
const disputes = { adjudicationRequests: z.array(PlanningAdjudicationRequest).optional() };
const proposedWork = PlanningWork.refine(
	(work) =>
		work.status === PlanningVocabulary.WorkState.Pending &&
		work.attemptSequence === 0 &&
		work.currentAttemptId === undefined &&
		work.resultReceiptId === undefined &&
		work.failureIds.length === 0 &&
		work.diagnosisIds.length === 0,
	'Roles may propose only unstarted work',
);
const proposedFinding = PlanningFinding.refine(
	(finding) =>
		finding.state === PlanningVocabulary.FindingState.Open &&
		finding.resolutionClaimIds.length === 0 &&
		finding.resolutionArtifacts.length === 0 &&
		finding.verificationReceiptIds.length === 0,
	'Roles may propose findings but cannot grant resolution',
);
const design = { ...disputes, claims, evidence: z.array(PlanningEvidence), work: z.array(proposedWork), findings: z.array(proposedFinding) };
const artifactEdits = z.array(z.object({ path: PlanningPath, baseHash: PlanningDigest.nullable(), content: z.string() }).strict());
const review = {
	unknownAssessments: z.array(PlanningUnknownAssessment).optional(),
	...disputes,
	findings: z.array(proposedFinding),
	coverage: PlanningReviewCoverage,
	verifiedFindings: z.array(z.object({ findingId: z.string().min(1), citations: z.array(PlanningCitation).min(1) }).strict()),
};
/** Role-specific proposals; unknown and out-of-role fields fail before state mutation. */
export const PlanningRoleResult = z.union([
	z
		.object({
			...identity,
			kind: z.literal(PlanningVocabulary.ResultKind.EvidenceRequest),
			role: z.enum(PlanningVocabulary.Role),
			requests: z.array(PlanningEvidenceRequest).min(1),
		})
		.strict(),
	terminal.extend({ role: z.literal(PlanningVocabulary.Role.Investigate), ...design }).strict(),
	terminal.extend({ role: z.literal(PlanningVocabulary.Role.Architect), ...design, ...layouts }).strict(),
	terminal.extend({ role: z.literal(PlanningVocabulary.Role.Draft), claims, artifactEdits, ...layouts, ...disputes }).strict(),
	terminal.extend({ role: z.literal(PlanningVocabulary.Role.DesignReview), ...review }).strict(),
	terminal.extend({ role: z.literal(PlanningVocabulary.Role.ImplementationReview), ...review }).strict(),
	terminal.extend({ role: z.literal(PlanningVocabulary.Role.IntegrationReview), ...review }).strict(),
	terminal
		.extend({
			role: z.literal(PlanningVocabulary.Role.Repair),
			...layouts,
			...disputes,
			claims,
			artifactEdits,
			resolutions: z.array(
				z
					.object({ findingId: z.string().min(1), claimIds: z.array(z.string().min(1)), artifacts: z.array(PlanningPath), explanation: z.string().min(1) })
					.strict(),
			),
		})
		.strict(),
	terminal
		.extend({
			role: z.literal(PlanningVocabulary.Role.Adjudicate),
			dispositions: z.array(
				z
					.object({
						findingIds: z.array(z.string().min(1)).min(1),
						outcome: z.enum(PlanningVocabulary.Disposition),
						reason: z.string().min(1),
						citations: z.array(PlanningCitation),
					})
					.strict(),
			),
		})
		.strict(),
	terminal
		.extend({
			role: z.literal(PlanningVocabulary.Role.Diagnose),
			...disputes,
			work: z.array(proposedWork),
			findings: z.array(proposedFinding),
			diagnosis: z.string().min(1),
		})
		.strict(),
]);
export type PlanningRoleResult = z.infer<typeof PlanningRoleResult>;

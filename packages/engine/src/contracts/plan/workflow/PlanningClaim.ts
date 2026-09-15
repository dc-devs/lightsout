import { z } from 'zod';
import { PlanningOrigin } from '#src/contracts/plan/workflow/common/types/PlanningOrigin.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningQuestion } from '#src/contracts/plan/workflow/common/types/PlanningQuestion.ts';
import { PlanningScope } from '#src/contracts/plan/workflow/common/types/PlanningScope.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

const shared = {
	id: z.string().min(1),
	text: z.string().min(1),
	explanation: z.string(),
	contentRevision: z.number().int().positive(),
	origin: PlanningOrigin,
	owner: z.enum(PlanningVocabulary.Owner),
	state: z.enum(PlanningVocabulary.ClaimState),
	dependencies: z.array(z.string().min(1)),
	scope: PlanningScope,
	supersedes: z.string().min(1).optional(),
	confirmationId: z.string().min(1).optional(),
	legacySettlementId: z.string().min(1).optional(),
};
const acceptance = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal(PlanningVocabulary.Acceptance.Test),
			criterion: z.string().min(1),
			testFile: PlanningPath,
			testName: z.string().min(1),
			gate: z.string().min(1),
		})
		.strict(),
	z.object({ kind: z.literal(PlanningVocabulary.Acceptance.Prose), path: PlanningPath, reason: z.string().min(1), verification: z.string().min(1) }).strict(),
]);
/** The binding semantic unit. Cross-reference and confirmation-content validation belongs to the record validator. */
export const PlanningClaim = z
	.discriminatedUnion('kind', [
		z.object({ ...shared, kind: z.literal(PlanningVocabulary.ClaimKind.Requirement) }).strict(),
		z.object({ ...shared, kind: z.literal(PlanningVocabulary.ClaimKind.Decision) }).strict(),
		z.object({ ...shared, kind: z.literal(PlanningVocabulary.ClaimKind.Constraint) }).strict(),
		z.object({ ...shared, kind: z.literal(PlanningVocabulary.ClaimKind.Architecture) }).strict(),
		z
			.object({
				...shared,
				kind: z.literal(PlanningVocabulary.ClaimKind.Contract),
				contract: z
					.object({
						signatures: z.array(z.string().min(1)).min(1),
						ordering: z.array(z.string()),
						failures: z.array(z.string()),
						boundaries: z.array(z.string()),
					})
					.strict(),
			})
			.strict(),
		z.object({ ...shared, kind: z.literal(PlanningVocabulary.ClaimKind.Acceptance), acceptance }).strict(),
		z.object({ ...shared, kind: z.literal(PlanningVocabulary.ClaimKind.Question), question: PlanningQuestion }).strict(),
	])
	.refine(
		(claim) =>
			claim.owner !== PlanningVocabulary.Owner.User ||
			claim.state !== PlanningVocabulary.ClaimState.Settled ||
			Number(claim.confirmationId !== undefined) + Number(claim.legacySettlementId !== undefined) === 1,
		'Settled user claims require exactly one current confirmation or historical settlement',
	);
export type PlanningClaim = z.infer<typeof PlanningClaim>;

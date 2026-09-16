import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningConfirmation, type PlanningQuestion, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningAlignmentBasis } from '#src/plan/workflow/common/review/planningAlignmentBasis.ts';
import { planningFindingSettlement } from '#src/plan/workflow/common/review/planningFindingSettlement.ts';
import { planningReviewObligations } from '#src/plan/workflow/common/review/planningReviewObligations.ts';
import { resolvePlanningAlignment } from '#src/plan/workflow/common/review/resolvePlanningAlignment.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Ask for final design alignment only after independent product challenge and substantive closure; no model can supply this approval. */
export const createPlanningAlignmentQuestion = ({
	snapshot,
}: Params): { id: string; question: PlanningQuestion; alignment: NonNullable<PlanningConfirmation['alignment']> } | undefined => {
	if (resolvePlanningAlignment({ snapshot })) return undefined;
	const obligations = planningReviewObligations({ snapshot, stage: PlanningVocabulary.Stage.Brainstorm });
	if (
		!obligations.fullSources ||
		obligations.uncoveredClaimIds.length > 0 ||
		snapshot.record.work.some((work) => work.stage === PlanningVocabulary.Stage.Brainstorm && work.status !== PlanningVocabulary.WorkState.Complete) ||
		snapshot.record.claims.some((claim) => claim.state === PlanningVocabulary.ClaimState.Unresolved) ||
		snapshot.record.findings.some(
			(finding) =>
				finding.severity === PlanningVocabulary.Severity.Blocking && !planningFindingSettlement({ snapshot, finding, reviews: obligations.receipts }),
		)
	)
		return undefined;
	const basis = planningAlignmentBasis({ snapshot });
	const sources = new Map(snapshot.record.sources.map((source) => [source.sha256, source]));
	const claims = obligations.claims.map(({ origin: _origin, ...claim }) => claim);
	return {
		id: `alignment:${basis.semanticDigest}`,
		alignment: { ...basis, challengeReceiptId: obligations.fullSources.id },
		question: {
			context: `The original design and settled decisions below have received independent product and architecture challenge. Approval preserves these behaviors, boundaries, rejected alternatives and standards, while delegating ordinary technical implementation choices within them.\n\n${[...sources.values()].map((source) => `${source.artifact} @ ${source.locator}\n${source.text}`).join('\n\n')}\n\nCurrent obligations and decisions:\n${canonicalJson({ value: claims })}`,
			question: 'Approve this challenged design and its stated technical delegation?',
			options: [
				{
					label: 'Approve current design',
					description: 'Preserve this exact design and delegate technical implementation within its recorded contracts and standards.',
				},
				{ label: 'Revise the design', description: 'Provide the change to the design; it will be challenged again before approval.' },
			],
			recommendation: 'Approve the current design if the preserved behavior and delegated boundaries match your intent.',
		},
	};
};

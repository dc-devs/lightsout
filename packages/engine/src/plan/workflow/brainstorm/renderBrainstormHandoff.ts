import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { BrainstormDecisions, DecisionSource, PlanningVocabulary } from '#src/contracts/index.ts';
import { resolvePlanningAlignment } from '#src/plan/workflow/common/review/resolvePlanningAlignment.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningCompletion } from '#src/plan/workflow/completion/index.ts';
import { evaluatePlanningReadiness } from '#src/plan/workflow/review/index.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Human views are exact projections of one independently challenged, explicitly aligned canonical design. */
export const renderBrainstormHandoff = ({ snapshot }: Params): Map<string, string> => {
	const completion = readPlanningCompletion({ snapshot, stage: PlanningVocabulary.Stage.Brainstorm });
	const alignment = resolvePlanningAlignment({ snapshot });
	const readiness = evaluatePlanningReadiness({
		snapshot,
		stage: PlanningVocabulary.Stage.Brainstorm,
		structural: [],
		dependenciesCurrent: completion !== undefined,
		assurance: completion?.assurance,
	});
	if (!alignment || !readiness.ready)
		throw new Error(`Brainstorm handoff requires completed notes-bound alignment: ${readiness.missingReason ?? 'Missing approval'}`);
	const claims = snapshot.record.claims.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded);
	const notes =
		[
			`# ${snapshot.record.planName}`,
			`Generation: ${snapshot.digest}`,
			'## Original intent',
			...snapshot.record.sources.map((source) => `### ${source.artifact} — ${source.locator}\n\n${source.text}`),
			'## Settled design and obligations',
			...claims.map((claim) => {
				const { text, explanation, origin, ...details } = claim;
				const { text: originalText, ...originReference } = origin;
				const captured = snapshot.record.sources.some((source) => canonicalJson({ value: source }) === canonicalJson({ value: origin }));
				return `### ${claim.id}\n\n${text}\n\n${explanation}\n\n${canonicalJson({ value: { ...details, origin: captured ? originReference : { ...originReference, text: originalText } } })}`;
			}),
			'## Alignment and technical delegation',
			canonicalJson({ value: snapshot.record.confirmations.find((confirmation) => confirmation.id === alignment.confirmationId) }),
			`Independent challenge: ${alignment.challengeReceiptId}`,
		].join('\n\n') + '\n';
	const decisions = BrainstormDecisions.parse({
		planName: snapshot.record.planName,
		decisions: claims
			.filter((claim) => claim.kind === PlanningVocabulary.ClaimKind.Decision)
			.map((claim) => ({
				source: DecisionSource.Brainstorm,
				question: claim.id,
				options: '',
				choice: claim.text,
				rationale: claim.explanation,
				assumption: claim.owner !== PlanningVocabulary.Owner.User,
			})),
	});
	return new Map([
		['brainstorm-notes.md', notes],
		['brainstorm-decisions.json', canonicalJson({ value: decisions })],
	]);
};

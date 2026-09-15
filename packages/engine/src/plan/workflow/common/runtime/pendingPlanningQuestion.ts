import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningClaim, type PlanningFinding, type PlanningQuestion, type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { PlanningQuestionCheckpoint } from '#src/plan/workflow/common/types/PlanningQuestionCheckpoint.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { createPlanningAlignmentQuestion } from '#src/plan/workflow/review/index.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	/** Final approval is asked only after current structural and unknown-reach checks. */
	includeAlignment?: boolean;
}

const presentQuestion = ({
	claim,
	finding,
	alignment,
}: {
	claim: PlanningClaim | undefined;
	finding: PlanningFinding | undefined;
	alignment: ReturnType<typeof createPlanningAlignmentQuestion>;
}) => {
	const conflict = finding
		? {
				context: `${finding.scenario}\n\n${finding.consequence}\n\n${finding.missingObligation}`,
				question: `How should this user-owned conflict be resolved: ${finding.scenario}?`,
				options: [],
				recommendation: finding.proposedResolution ?? 'Resolve the conflicting user-owned behavior before continuing.',
			}
		: undefined;
	const question: PlanningQuestion | undefined = claim
		? claim.kind === PlanningVocabulary.ClaimKind.Question
			? claim.question
			: {
					context: `${claim.text}\n\n${claim.explanation}\n\nOriginal source: ${claim.origin.text}`,
					question: `Confirm or revise this requirement: ${claim.text}`,
					options: [],
					recommendation: claim.text,
				}
		: (conflict ?? alignment?.question);
	return question;
};

/** Persist one full-context user decision. Re-reading it spends no model call and retains its checkpoint. */
export const pendingPlanningQuestion = async ({
	runtime,
	snapshot,
	includeAlignment = true,
}: Params): Promise<Extract<PlanningRunResult, { status: typeof PlanningVocabulary.Status.AwaitingUser }> | undefined> => {
	const claim = snapshot.record.claims.find((item) => item.owner === PlanningVocabulary.Owner.User && item.state === PlanningVocabulary.ClaimState.Unresolved);
	const finding = snapshot.record.findings.find((item) => item.owner === PlanningVocabulary.Owner.User && item.state === PlanningVocabulary.FindingState.Open);
	const alignment =
		includeAlignment && !claim && !finding && runtime.stage === PlanningVocabulary.Stage.Brainstorm ? createPlanningAlignmentQuestion({ snapshot }) : undefined;
	const subject = claim ?? finding;
	if (!subject && !alignment) return undefined;
	const questionId = subject?.id ?? alignment?.id ?? '';
	const question = presentQuestion({ claim, finding, alignment });
	if (!question) throw new Error('Pending obligation has no question context');

	const sourceDigest = sha256({ content: canonicalJson({ value: snapshot.record.sources }) });
	const questionDigest = sha256({
		content: canonicalJson({ value: { questionId, question, sourceDigest, ...(alignment ? { alignment: alignment.alignment } : {}) } }),
	});
	const path = `planning-questions/${sha256({ content: `${questionId}:${questionDigest}` })}.json`;
	const saved = await updatePlanningSnapshot({
		runtime,
		propose: async (current) => {
			if (
				canonicalJson({
					value: current.record.claims.find((item) => item.id === questionId) ?? current.record.findings.find((item) => item.id === questionId),
				}) !== canonicalJson({ value: claim ?? finding })
			)
				throw new Error('Question meaning changed while creating its checkpoint');
			if (
				alignment &&
				canonicalJson({ value: createPlanningAlignmentQuestion({ snapshot: current })?.alignment }) !== canonicalJson({ value: alignment.alignment })
			)
				throw new Error('Design alignment changed before its checkpoint');
			if (current.artifacts.has(path)) return undefined;
			if (sha256({ content: canonicalJson({ value: current.record.sources }) }) !== sourceDigest)
				throw new Error('Question sources changed while creating the checkpoint');
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			attachPlanningData({
				record,
				artifacts,
				path,
				value: {
					questionId,
					questionDigest,
					question,
					sourceDigest,
					checkpointRevision: current.record.revision + 1,
					...(alignment ? { alignment: alignment.alignment } : {}),
				},
			});
			return { record, artifacts };
		},
	});
	const content = saved.artifacts.get(path);
	if (content === undefined) throw new Error('Question checkpoint bytes are missing');
	const checkpoint = PlanningQuestionCheckpoint.parse(JSON.parse(content));
	return {
		status: PlanningVocabulary.Status.AwaitingUser,
		name: runtime.name,
		generation: saved.digest,
		questionId,
		questionDigest,
		question,
		checkpointRevision: checkpoint.checkpointRevision,
	};
};

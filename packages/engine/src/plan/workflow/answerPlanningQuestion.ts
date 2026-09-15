import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningAnswer, type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { pendingPlanningQuestion } from '#src/plan/workflow/common/runtime/pendingPlanningQuestion.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { PlanningQuestionCheckpoint } from '#src/plan/workflow/common/types/PlanningQuestionCheckpoint.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { createPlanningAlignmentQuestion } from '#src/plan/workflow/review/index.ts';
import { runPlanning } from '#src/plan/workflow/runPlanning/index.ts';
import { planningDataArtifact, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	answer: PlanningAnswer;
}

const applyAnswer = ({
	current,
	expectedGeneration,
	answer,
	alignment,
	approvesAlignment,
	text,
}: {
	current: PlanningSnapshot;
	expectedGeneration: string;
	answer: PlanningAnswer;
	alignment: PlanningQuestionCheckpoint['alignment'];
	approvesAlignment: boolean;
	text: string;
}) => {
	if (current.digest !== expectedGeneration) throw new Error('Planning changed before this answer could be accepted');
	const record = structuredClone(current.record);
	const artifacts = new Map(current.artifacts);
	if (approvesAlignment) {
		const currentAlignment = createPlanningAlignmentQuestion({ snapshot: current });
		if (!currentAlignment || canonicalJson({ value: currentAlignment.alignment }) !== canonicalJson({ value: alignment }))
			throw new Error('The challenged design changed before approval');
		record.confirmations.push({ ...answer.confirmation, alignment: alignment });
		return { record, artifacts };
	}
	const old = record.claims.find((claim) => claim.id === answer.questionId);
	const finding = record.findings.find((item) => item.id === answer.questionId);
	const scope = old?.scope ?? finding?.scope ?? (alignment ? answer.confirmation.delegation : undefined);
	if (!scope) throw new Error('The answered obligation no longer exists');
	const origin = {
		artifact: `foreground/${answer.confirmation.id}.txt`,
		locator: answer.confirmation.messageId,
		text,
		sha256: answer.confirmation.approvedDigest,
	};
	const id = `answer:${sha256({ content: canonicalJson({ value: answer }) })}`;
	record.sources.push(origin);
	record.confirmations.push(answer.confirmation);
	record.claims.push({
		id,
		kind: PlanningVocabulary.ClaimKind.Decision,
		text,
		explanation: `Foreground answer to ${answer.questionId}`,
		origin,
		owner: PlanningVocabulary.Owner.User,
		state: PlanningVocabulary.ClaimState.Settled,
		contentRevision: 1,
		dependencies: old?.dependencies ?? [],
		scope,
		confirmationId: answer.confirmation.id,
		...(old ? { supersedes: old.id } : {}),
	});
	if (old)
		for (const dependent of record.claims) {
			dependent.dependencies = dependent.dependencies.map((dependency) => (dependency === old.id ? id : dependency));
		}
	if (old) {
		old.state = PlanningVocabulary.ClaimState.Superseded;
		if (old.kind === PlanningVocabulary.ClaimKind.Question) old.question.answerId = id;
	}
	if (finding) {
		finding.owner = PlanningVocabulary.Owner.Planner;
		finding.proposedResolution = text;
	}
	const path = `planning-originals/${origin.sha256}.txt`;
	artifacts.set(path, text);
	if (!record.artifacts.some((artifact) => artifact.path === path)) record.artifacts.push(planningDataArtifact({ path, content: text }));
	return { record, artifacts };
};

/** Accept only an explicit answer to the current checkpoint, then continue without repeating settled product choices. */
export const answerPlanningQuestion = async ({ runtime, answer: proposed }: Params): Promise<PlanningRunResult> => {
	const answer = PlanningAnswer.parse(proposed);
	const snapshot = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!snapshot) throw new Error('No planning question exists');
	const pending = await pendingPlanningQuestion({ runtime, snapshot });
	if (
		!pending ||
		pending.questionId !== answer.questionId ||
		pending.questionDigest !== answer.questionDigest ||
		pending.checkpointRevision !== answer.checkpointRevision
	)
		throw new Error('The planning answer does not match the current checkpoint');
	const checkpoint = readPlanningProof({
		snapshot,
		path: `planning-questions/${sha256({ content: `${pending.questionId}:${pending.questionDigest}` })}.json`,
		schema: PlanningQuestionCheckpoint,
	});
	if (!checkpoint) throw new Error('The current question checkpoint is missing or corrupt');
	if (answer.confirmation.alignment) throw new Error('Only the engine may bind an answer to the exact current alignment checkpoint');
	const approvesAlignment = checkpoint.alignment !== undefined && answer.selectedOption === pending.question.options[0]?.label && answer.freeText === undefined;
	if (checkpoint.alignment && !approvesAlignment && !answer.freeText) throw new Error('A design revision requires its actual requested change');
	const text = answer.freeText ?? pending.question.options.find((option) => option.label === answer.selectedOption)?.label;
	if (!text || answer.confirmation.messageText !== text || answer.confirmation.approvedDigest !== sha256({ content: text }))
		throw new Error('Foreground confirmation must bind the exact approved answer bytes');
	if (
		snapshot.record.confirmations.some((confirmation) => confirmation.messageId === answer.confirmation.messageId || confirmation.id === answer.confirmation.id)
	)
		throw new Error('A prior message cannot impersonate a new approval');
	await updatePlanningSnapshot({
		runtime,
		propose: async (current) => applyAnswer({ current, expectedGeneration: snapshot.digest, answer, alignment: checkpoint.alignment, approvesAlignment, text }),
	});
	return runPlanning({ runtime });
};

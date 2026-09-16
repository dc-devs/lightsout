import { randomUUID } from 'node:crypto';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningAnswer, type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningAnswer } from '#src/plan/workflow/common/answers/applyPlanningAnswer.ts';
import { adoptPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/adoptPlanningExecutionPolicy.ts';
import { pendingPlanningQuestion } from '#src/plan/workflow/common/questions/pendingPlanningQuestion.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { PlanningProposalApproval } from '#src/plan/workflow/common/types/questions/PlanningProposalApproval.ts';
import { PlanningQuestionCheckpoint } from '#src/plan/workflow/common/types/questions/PlanningQuestionCheckpoint.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { refreshPlanningCycle, runPlanning } from '#src/plan/workflow/runPlanning/index.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	answer: PlanningAnswer;
}

/** Accept only an explicit answer to the current checkpoint, then continue without repeating settled product choices. */
export const answerPlanningQuestion = async ({ runtime, answer: proposed }: Params): Promise<PlanningRunResult> => {
	const answer = PlanningAnswer.parse(proposed);
	let snapshot = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!snapshot) throw new Error('No planning question exists');
	snapshot = await adoptPlanningExecutionPolicy({ runtime, snapshot });
	let pending = await pendingPlanningQuestion({ runtime, snapshot });
	if (!pending && runtime.services.proposal) {
		const cycle = await refreshPlanningCycle({ runtime, snapshot, cycleId: randomUUID() });
		pending = cycle.result?.status === PlanningVocabulary.Status.AwaitingUser ? cycle.result : undefined;
		const latest = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
		if (!latest) throw new Error('Planning generation disappeared before proposal approval');
		snapshot = latest;
	}
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
	const approvesProposal = checkpoint.proposal !== undefined && answer.selectedOption === pending.question.options[0]?.label && answer.freeText === undefined;
	if (checkpoint.proposal && !approvesProposal && !answer.freeText) throw new Error('A proposal revision requires its actual requested change');
	if (checkpoint.alignment && !approvesAlignment && !answer.freeText) throw new Error('A design revision requires its actual requested change');
	const text = answer.freeText ?? pending.question.options.find((option) => option.label === answer.selectedOption)?.label;
	if (!text || answer.confirmation.messageText !== text || answer.confirmation.approvedDigest !== sha256({ content: text }))
		throw new Error('Foreground confirmation must bind the exact approved answer bytes');
	if (
		[
			...snapshot.record.confirmations,
			...[...snapshot.artifacts]
				.filter(([path]) => path.startsWith('planning-proposal-approvals/'))
				.map(([, text]) => PlanningProposalApproval.parse(JSON.parse(text)).confirmation),
		].some((confirmation) => confirmation.messageId === answer.confirmation.messageId || confirmation.id === answer.confirmation.id)
	)
		throw new Error('A prior message cannot impersonate a new approval');
	await updatePlanningSnapshot({
		runtime,
		propose: async (current) =>
			applyPlanningAnswer({
				current,
				expectedGeneration: snapshot.digest,
				answer,
				alignment: checkpoint.alignment,
				approvesAlignment,
				proposal: checkpoint.proposal,
				approvesProposal,
				text,
			}),
	});
	return runPlanning({ runtime });
};

import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningAnswer, PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningDecisionAnswer } from '#src/plan/workflow/common/answers/applyPlanningDecisionAnswer.ts';
import { createPlanningAlignmentQuestion } from '#src/plan/workflow/common/review/createPlanningAlignmentQuestion.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningProposalApproval } from '#src/plan/workflow/common/types/questions/PlanningProposalApproval.ts';
import type { PlanningQuestionCheckpoint } from '#src/plan/workflow/common/types/questions/PlanningQuestionCheckpoint.ts';
import { createPlanningProposal } from '#src/plan/workflow/proposal/index.ts';

interface Params {
	current: PlanningSnapshot;
	expectedGeneration: string;
	answer: PlanningAnswer;
	alignment: PlanningQuestionCheckpoint['alignment'];
	approvesAlignment: boolean;
	proposal: PlanningQuestionCheckpoint['proposal'];
	approvesProposal: boolean;
	text: string;
}

/** Apply one exact checkpoint answer, retaining the distinction between approval and changed intent. */
export const applyPlanningAnswer = ({
	current,
	expectedGeneration,
	answer,
	alignment,
	approvesAlignment,
	proposal,
	approvesProposal,
	text,
}: Params): { record: PlanningSnapshot['record']; artifacts: Map<string, string> } => {
	if (current.digest !== expectedGeneration) throw new Error('Planning changed before this answer could be accepted');
	const record = structuredClone(current.record);
	const artifacts = new Map(current.artifacts);
	if (approvesProposal && proposal) {
		if (createPlanningProposal({ snapshot: current, position: proposal.position }).digest !== proposal.digest)
			throw new Error('The proposal changed before approval');
		attachPlanningData({
			record,
			artifacts,
			path: `planning-proposal-approvals/${proposal.digest}.json`,
			value: PlanningProposalApproval.parse({
				format: 'planning-proposal-approval-v1',
				questionId: answer.questionId,
				questionDigest: answer.questionDigest,
				checkpointRevision: answer.checkpointRevision,
				acceptedRevision: current.record.revision + 1,
				confirmation: answer.confirmation,
			}),
		});
	} else if (approvesAlignment) {
		const currentAlignment = createPlanningAlignmentQuestion({ snapshot: current });
		if (!currentAlignment || canonicalJson({ value: currentAlignment.alignment }) !== canonicalJson({ value: alignment }))
			throw new Error('The challenged design changed before approval');
		record.confirmations.push({ ...answer.confirmation, alignment: alignment });
	} else {
		applyPlanningDecisionAnswer({
			record,
			artifacts,
			answer,
			text,
			fallbackScope: alignment
				? answer.confirmation.delegation
				: proposal
					? { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] }
					: undefined,
		});
	}
	return { record, artifacts };
};

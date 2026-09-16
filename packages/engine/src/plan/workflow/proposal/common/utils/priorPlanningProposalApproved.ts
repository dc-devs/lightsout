import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningProposalPosition } from '#src/plan/workflow/common/constants/PlanningProposalPosition.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningProposalApproval } from '#src/plan/workflow/common/types/questions/PlanningProposalApproval.ts';
import { PlanningQuestionCheckpoint } from '#src/plan/workflow/common/types/questions/PlanningQuestionCheckpoint.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { createPlanningProposal } from '#src/plan/workflow/proposal/createPlanningProposal.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Approval survives prose authoring, but any changed design, phase boundary, delegation or standards requires renewal. */
export const priorPlanningProposalApproved = ({ snapshot }: Params): boolean => {
	const proposal = createPlanningProposal({ snapshot, position: PlanningProposalPosition.BeforeDraft });
	return snapshot.record.artifacts
		.filter((item) => item.path.startsWith('planning-proposal-approvals/'))
		.some((item) => {
			const approval = readPlanningProof({ snapshot, path: item.path, schema: PlanningProposalApproval });
			if (!approval) return false;
			const path = `planning-questions/${sha256({ content: `${approval.questionId}:${approval.questionDigest}` })}.json`;
			const checkpoint = readPlanningProof({ snapshot, path, schema: PlanningQuestionCheckpoint });
			return checkpoint?.proposal?.position === PlanningProposalPosition.BeforeDraft && checkpoint.questionDigest === proposal.digest;
		});
};

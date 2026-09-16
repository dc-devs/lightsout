import type { LightsoutConfig } from '#src/contracts/index.ts';
import { validatePlanningProposalApprovals } from '#src/plan/workflow/common/answers/validatePlanningProposalApprovals.ts';
import { PlanningProposalPosition } from '#src/plan/workflow/common/constants/PlanningProposalPosition.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningProposalApproval } from '#src/plan/workflow/common/types/questions/PlanningProposalApproval.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { priorPlanningProposalApproved } from '#src/plan/workflow/proposal/common/utils/priorPlanningProposalApproved.ts';
import { createPlanningProposal } from '#src/plan/workflow/proposal/createPlanningProposal.ts';

interface Params {
	snapshot: PlanningSnapshot;
	config: LightsoutConfig;
}

/** A finished plan still needs the approval required by current configuration, bound to its exact proposal. */
export const hasPlanningProposalApproval = ({ snapshot, config }: Params): boolean => {
	if (config['auto-plan']?.['auto-approve-plan']) return true;
	validatePlanningProposalApprovals({ snapshot });
	if (config['auto-plan']?.['propose-before-draft'] && priorPlanningProposalApproved({ snapshot })) return true;
	const proposal = createPlanningProposal({ snapshot, position: PlanningProposalPosition.AfterReady });
	const approval = readPlanningProof({ snapshot, path: `planning-proposal-approvals/${proposal.digest}.json`, schema: PlanningProposalApproval });
	return approval?.questionId === proposal.id && approval.questionDigest === proposal.digest;
};

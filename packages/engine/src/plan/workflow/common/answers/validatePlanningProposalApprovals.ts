import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningProposalApproval } from '#src/plan/workflow/common/types/questions/PlanningProposalApproval.ts';
import { PlanningQuestionCheckpoint } from '#src/plan/workflow/common/types/questions/PlanningQuestionCheckpoint.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';

interface Params {
	snapshot: PlanningSnapshot;
	previous?: PlanningSnapshot;
}

/** Historical workflow approval requires its exact earlier checkpoint and a unique explicit foreground message. */
export const validatePlanningProposalApprovals = ({ snapshot, previous }: Params): void => {
	const ids = new Set(snapshot.record.confirmations.map((item) => item.id));
	const messages = new Set(snapshot.record.confirmations.map((item) => item.messageId));
	for (const descriptor of snapshot.record.artifacts.filter((item) => item.path.startsWith('planning-proposal-approvals/'))) {
		const approval = readPlanningProof({ snapshot, path: descriptor.path, schema: PlanningProposalApproval });
		if (
			!approval ||
			descriptor.variant !== PlanningVocabulary.Artifact.Data ||
			descriptor.path !== `planning-proposal-approvals/${approval.questionDigest}.json`
		)
			throw new Error('Invalid planning proposal approval proof');
		const path = `planning-questions/${sha256({ content: `${approval.questionId}:${approval.questionDigest}` })}.json`;
		const checkpoint = readPlanningProof({ snapshot, path, schema: PlanningQuestionCheckpoint });
		const checkpointDescriptor = snapshot.record.artifacts.find((item) => item.path === path);
		if (
			!checkpoint?.proposal ||
			checkpointDescriptor?.variant !== PlanningVocabulary.Artifact.Data ||
			checkpoint.questionId !== approval.questionId ||
			checkpoint.questionDigest !== approval.questionDigest ||
			checkpoint.proposal.digest !== approval.questionDigest ||
			checkpoint.questionId !== `proposal:${checkpoint.proposal.position}` ||
			checkpoint.checkpointRevision !== approval.checkpointRevision ||
			approval.acceptedRevision <= checkpoint.checkpointRevision ||
			approval.acceptedRevision > snapshot.record.revision
		)
			throw new Error('Proposal approval does not identify its earlier checkpoint');
		if (previous && !previous.artifacts.has(descriptor.path) && (!previous.artifacts.has(path) || approval.acceptedRevision !== snapshot.record.revision))
			throw new Error('Proposal checkpoint must exist before its approval transition');
		const confirmation = approval.confirmation;
		if (
			confirmation.alignment ||
			confirmation.messageText !== checkpoint.question.options[0]?.label ||
			confirmation.messageText !== 'Approve proposal' ||
			sha256({ content: confirmation.messageText }) !== confirmation.approvedDigest
		)
			throw new Error('Proposal approval lacks exact explicit confirmation');
		if (ids.has(confirmation.id) || messages.has(confirmation.messageId)) throw new Error('Proposal approval cannot reuse foreground message identity');
		ids.add(confirmation.id);
		messages.add(confirmation.messageId);
	}
};

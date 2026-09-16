import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { validatePlanningProposalApprovals } from '#src/plan/workflow/common/answers/validatePlanningProposalApprovals.ts';
import { PlanningProposalPosition } from '#src/plan/workflow/common/constants/PlanningProposalPosition.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningAssuranceContext } from '#src/plan/workflow/common/types/PlanningAssuranceContext.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningProposalApproval } from '#src/plan/workflow/common/types/questions/PlanningProposalApproval.ts';
import { PlanningQuestionCheckpoint } from '#src/plan/workflow/common/types/questions/PlanningQuestionCheckpoint.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { planningDesignReadyForProposal } from '#src/plan/workflow/proposal/common/utils/planningDesignReadyForProposal.ts';
import { priorPlanningProposalApproved } from '#src/plan/workflow/proposal/common/utils/priorPlanningProposalApproved.ts';
import { createPlanningProposal } from '#src/plan/workflow/proposal/createPlanningProposal.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	ready: boolean;
	assurance?: PlanningAssuranceContext;
}

/** Honor configured proposal timing after real review; approval cannot be inferred from silence or an exhausted question count. */
export const pendingPlanningProposal = async ({
	runtime,
	snapshot,
	ready,
	assurance,
}: Params): Promise<Extract<PlanningRunResult, { status: typeof PlanningVocabulary.Status.AwaitingUser }> | undefined> => {
	if (runtime.stage !== PlanningVocabulary.Stage.Implementation || runtime.config['auto-plan']?.['auto-approve-plan']) return undefined;
	let position = runtime.config['auto-plan']?.['propose-before-draft'] ? PlanningProposalPosition.BeforeDraft : PlanningProposalPosition.AfterReady;
	if (position === PlanningProposalPosition.AfterReady && !ready) return undefined;
	if (position === PlanningProposalPosition.BeforeDraft) {
		const draft = snapshot.record.work.some(
			(work) => work.stage === runtime.stage && work.role === PlanningVocabulary.Role.Draft && work.status === PlanningVocabulary.WorkState.Complete,
		);
		if (draft) {
			validatePlanningProposalApprovals({ snapshot });
			if (priorPlanningProposalApproved({ snapshot })) return undefined;
			if (!ready) return undefined;
			position = PlanningProposalPosition.AfterReady;
		} else if (!planningDesignReadyForProposal({ snapshot, assurance })) return undefined;
	}
	validatePlanningProposalApprovals({ snapshot });

	const proposal = createPlanningProposal({ snapshot, position });
	const path = `planning-questions/${sha256({ content: `${proposal.id}:${proposal.digest}` })}.json`;
	const approvalPath = `planning-proposal-approvals/${proposal.digest}.json`;
	const approved = readPlanningProof({ snapshot, path: approvalPath, schema: PlanningProposalApproval });
	if (approved?.questionId === proposal.id && approved.questionDigest === proposal.digest) return undefined;
	const saved = await updatePlanningSnapshot({
		runtime,
		propose: async (current) => {
			if (createPlanningProposal({ snapshot: current, position }).digest !== proposal.digest)
				throw new Error('Planning proposal changed before its checkpoint');
			if (current.artifacts.has(path)) return undefined;
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			attachPlanningData({
				record,
				artifacts,
				path,
				value: {
					questionId: proposal.id,
					questionDigest: proposal.digest,
					question: proposal.question,
					sourceDigest: sha256({ content: canonicalJson({ value: record.sources }) }),
					checkpointRevision: current.record.revision + 1,
					proposal: { position, digest: proposal.digest },
				},
			});
			return { record, artifacts };
		},
	});
	const checkpoint = readPlanningProof({ snapshot: saved, path, schema: PlanningQuestionCheckpoint });
	if (!checkpoint) throw new Error('Planning proposal checkpoint is missing or corrupt');
	return {
		status: PlanningVocabulary.Status.AwaitingUser,
		name: runtime.name,
		generation: saved.digest,
		questionId: proposal.id,
		questionDigest: proposal.digest,
		question: proposal.question,
		checkpointRevision: checkpoint.checkpointRevision,
	};
};

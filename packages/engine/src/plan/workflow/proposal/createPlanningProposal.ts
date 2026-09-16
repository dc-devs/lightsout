import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningQuestion, PlanningVocabulary } from '#src/contracts/index.ts';
import { PlanningProposalPosition } from '#src/plan/workflow/common/constants/PlanningProposalPosition.ts';
import { planningAlignmentBasis } from '#src/plan/workflow/common/review/planningAlignmentBasis.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { renderPlanningDesignProposal } from '#src/plan/workflow/proposal/common/utils/renderPlanningDesignProposal.ts';

interface Params {
	snapshot: PlanningSnapshot;
	position: PlanningProposalPosition;
}

/** Bind the proposed design or completed deliverables without including approval bookkeeping in its own identity. */
export const createPlanningProposal = ({ snapshot, position }: Params): { id: string; digest: string; question: PlanningQuestion } => {
	const artifacts = snapshot.record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data);
	const basis = {
		position,
		alignment: planningAlignmentBasis({ snapshot }),
		artifacts: artifacts.map(({ sha256: contentDigest, ...layout }) => ({
			...layout,
			...(position === PlanningProposalPosition.AfterReady ? { sha256: contentDigest, content: snapshot.artifacts.get(layout.path) } : {}),
		})),
	};
	const digest = sha256({ content: canonicalJson({ value: basis }) });
	const context =
		position === PlanningProposalPosition.BeforeDraft
			? renderPlanningDesignProposal({ snapshot })
			: artifacts.map((artifact) => `# ${artifact.path}\n\n${snapshot.artifacts.get(artifact.path) ?? ''}`).join('\n\n');
	return {
		id: `proposal:${position}`,
		digest,
		question: {
			context: context || 'The proposed design has no recorded obligations.',
			question:
				position === PlanningProposalPosition.BeforeDraft
					? 'Approve this independently challenged design for detailed planning?'
					: 'Approve this fully reviewed implementation plan?',
			options: [
				{ label: 'Approve proposal', description: 'Continue with this exact proposal and the recorded implementation freedom.' },
				{ label: 'Revise proposal', description: 'Provide the required change before planning continues.' },
			],
			recommendation: 'Approve proposal',
		},
	};
};

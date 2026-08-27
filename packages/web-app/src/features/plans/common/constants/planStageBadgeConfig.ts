import { PlanStage } from '@lightsout/engine/contracts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import { planStageLabels } from '#src/features/plans/common/constants/planStageLabels.ts';

/**
 * Stage → badge label and family, by how far along the plan is. Passed straight
 * to `StatusBadge`'s `config`.
 *
 * The families read as progress here rather than as a run outcome: the closed
 * set has no other readable progression, and the brand accent stays in the three
 * places it is allowed.
 */
export const planStageBadgeConfig: Record<PlanStage, { label: string; variant: BadgeVariant }> = {
	[PlanStage.Started]: { label: planStageLabels[PlanStage.Started], variant: BadgeVariant.Neutral },
	[PlanStage.NotesOnly]: { label: planStageLabels[PlanStage.NotesOnly], variant: BadgeVariant.Neutral },
	[PlanStage.Drafted]: { label: planStageLabels[PlanStage.Drafted], variant: BadgeVariant.Advisory },
	[PlanStage.Graded]: { label: planStageLabels[PlanStage.Graded], variant: BadgeVariant.Running },
	[PlanStage.Implemented]: { label: planStageLabels[PlanStage.Implemented], variant: BadgeVariant.Passed },
};

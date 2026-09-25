import { PlanStage } from '@lightsout/engine/contracts';

/** What each stage is called on screen — the stage's own name, never a guess at what a workspace is missing. */
export const planStageLabels: Record<PlanStage, string> = {
	[PlanStage.Started]: 'started',
	[PlanStage.NotesOnly]: 'notes only',
	[PlanStage.Drafted]: 'drafted',
	[PlanStage.Graded]: 'graded',
	[PlanStage.Implemented]: 'implemented',
};

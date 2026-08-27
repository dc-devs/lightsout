import type { PlanWorkspaceFile, PlanWorkspaceListing } from '@lightsout/engine';
import { type PlanGrade, PlanStage } from '@lightsout/engine/contracts';

interface Params {
	name?: string;
	stage?: PlanStage;
	/** Left out entirely by default, which is a workspace nothing has graded. */
	grade?: PlanGrade;
	hasNotes?: boolean;
	hasPlanFile?: boolean;
	implementedFiles?: PlanWorkspaceFile[];
	phased?: boolean;
	phaseCount?: number;
	updatedAt?: string;
	runCount?: number;
}

/** One row of the plans list, filled in as the engine fills it, with only what a test cares about overridden. */
export const buildPlanWorkspaceListing = ({
	name = 'add-search',
	stage = PlanStage.Drafted,
	grade,
	hasNotes = false,
	hasPlanFile = true,
	implementedFiles = [],
	phased = false,
	phaseCount = 0,
	updatedAt = '2026-01-01T00:00:00.000Z',
	runCount = 0,
}: Params = {}): PlanWorkspaceListing => ({
	name,
	stage,
	grade,
	hasNotes,
	hasPlanFile,
	implementedFiles,
	phased,
	phaseCount,
	updatedAt,
	runCount,
});

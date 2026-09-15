import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { type GradeReport, PlanningVocabulary } from '#src/contracts/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { createPlanningGrade } from '#src/plan/workflow/review/createPlanningGrade.ts';
import { evaluatePlanningReadiness } from '#src/plan/workflow/review/evaluatePlanningReadiness.ts';
import { refreshPlanningCycle } from '#src/plan/workflow/runPlanning/index.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
}

/** Refresh actual standards, dependencies and structural checks before rendering the current canonical grade. Missing review remains incomplete. */
export const runPlanningGrade = async ({ runtime }: Params): Promise<{ workspaceDir: string; grade: GradeReport; gradePath: string }> => {
	const snapshot = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!snapshot) throw new Error('Canonical planning input is unavailable');
	if (runtime.stage !== PlanningVocabulary.Stage.Implementation) throw new Error('Implementation grading requires the implementation stage');
	const cycle = await refreshPlanningCycle({ runtime, snapshot, cycleId: randomUUID() });
	const readiness =
		cycle.readiness ?? evaluatePlanningReadiness({ snapshot: cycle.snapshot, structural: cycle.structural, dependenciesCurrent: false, stage: runtime.stage });
	const grade = createPlanningGrade({ snapshot: cycle.snapshot, readiness, structural: cycle.structural });
	const workspaceDir = planWorkspaceDir({ cwd: runtime.cwd, name: runtime.name });
	const gradePath = join(workspaceDir, 'grade.json');
	await writeJsonFile({ path: gradePath, value: grade });
	await appendGradeHistory({ cwd: runtime.cwd, name: runtime.name, report: grade });
	return { workspaceDir, grade, gradePath };
};

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { GradeReport, GradeScope, PlanGrade, PlanningVocabulary } from '#src/contracts/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { selectPhaseFiles } from '#src/plan/common/utils/selectPhaseFiles.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { adoptPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/adoptPlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { createPlanningGrade } from '#src/plan/workflow/review/createPlanningGrade.ts';
import { evaluatePlanningReadiness } from '#src/plan/workflow/review/evaluatePlanningReadiness.ts';
import { refreshPlanningCycle } from '#src/plan/workflow/runPlanning/index.ts';
import { readPlanningEntrySnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	phases?: string[];
}

/** Refresh actual standards, dependencies and structural checks before rendering the current canonical grade. Missing review remains incomplete. */
export const runPlanningGrade = async ({ runtime, phases }: Params): Promise<{ workspaceDir: string; grade: GradeReport; gradePath: string }> => {
	const snapshot = await readPlanningEntrySnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!snapshot) throw new Error('Canonical planning input is unavailable');
	if (runtime.stage !== PlanningVocabulary.Stage.Implementation) throw new Error('Implementation grading requires the implementation stage');
	const selection = selectPhaseFiles({
		files: snapshot.record.artifacts
			.filter((item) => item.variant === PlanningVocabulary.Artifact.Single || item.variant === PlanningVocabulary.Artifact.Phase)
			.map((item) => ({ path: item.path, text: snapshot.artifacts.get(item.path) ?? '' })),
		phases,
	});
	if ('error' in selection) throw new Error(selection.error);
	const adopted = await adoptPlanningExecutionPolicy({ runtime, snapshot });
	const cycle = await refreshPlanningCycle({ runtime, snapshot: adopted, cycleId: randomUUID() });
	const reviewed =
		cycle.readiness ?? evaluatePlanningReadiness({ snapshot: cycle.snapshot, structural: cycle.structural, dependenciesCurrent: false, stage: runtime.stage });
	const readiness =
		cycle.result?.status === PlanningVocabulary.Status.AwaitingUser
			? {
					...reviewed,
					ready: false,
					unresolvedQuestionIds: [...reviewed.unresolvedQuestionIds, cycle.result.questionId],
					missingReason: 'The current proposal requires explicit approval.',
				}
			: reviewed;
	const full = createPlanningGrade({ snapshot: cycle.snapshot, readiness, structural: cycle.structural });
	const grade =
		phases === undefined
			? full
			: GradeReport.parse({
					...full,
					grade: PlanGrade.BelowA,
					passed: false,
					complete: false,
					scope: GradeScope.Focused,
					focusedOn: selection.selected.map((item) => item.path),
					phasesChecked: full.phasesChecked.filter((path) => selection.selected.some((item) => item.path === path)),
					incompleteReason: 'A requested phase-only report cannot authorize the complete plan.',
				});
	const workspaceDir = planWorkspaceDir({ cwd: runtime.cwd, name: runtime.name });
	const gradePath = join(workspaceDir, 'grade.json');
	await writeJsonFile({ path: gradePath, value: grade });
	await appendGradeHistory({ cwd: runtime.cwd, name: runtime.name, report: grade });
	return { workspaceDir, grade, gradePath };
};

import { readConfig } from '#src/common/config/readConfig.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { hasPlanningWorkflow } from '#src/plan/common/paths/hasPlanningWorkflow.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import { createPlanningRuntime, PlanningMode, type PlanningRuntime } from '#src/plan/workflow/index.ts';

/** Existing public grading/scanning calls cannot fall back to legacy interpretation of canonical input. */
export const resolvePlanningAdapterRuntime = async ({
	cwd,
	name,
	driver,
	model,
	effort,
	permissions,
	onProgress,
}: PlanGradeParams): Promise<PlanningRuntime | undefined> => {
	if (!(await hasPlanningWorkflow({ cwd, name }))) return undefined;
	const config = await readConfig({ cwd });
	config.commands = { ...config.commands, plan: { ...config.commands?.plan, ...(model ? { model } : {}), ...(effort ? { effort } : {}) } };
	return createPlanningRuntime({
		cwd,
		name,
		driver,
		config,
		mode: PlanningMode.Interactive,
		stage: PlanningVocabulary.Stage.Implementation,
		permissions,
		onProgress,
	});
};

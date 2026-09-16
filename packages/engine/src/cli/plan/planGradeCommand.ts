import { printPlanningFinding } from '#src/cli/common/render/planning/printPlanningFinding.ts';
import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { preparePlanningCommand } from '#src/cli/plan/common/utils/preparePlanningCommand.ts';
import { type LightsoutConfig, PlanningStep, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { PlanRunStatus, recordPlanningStep, runPlanGrade } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
	/** Explicit phase selection remains an incomplete report and never authorizes the whole plan. */
	phases?: string[];
}

/** Project current canonical review evidence; grade does not launch another reader fleet or infer missing approval. */
export const planGradeCommand = async ({ cwd, driver, name, config, phases }: Params): Promise<void> => {
	const runtime = await preparePlanningCommand({ cwd, driver, name, config });
	const result = await recordPlanningStep({
		cwd,
		name,
		step: PlanningStep.Grade,
		work: () => runPlanGrade({ runtime, phases }),
		statusOf: ({ result: graded }) => (graded.status === PlanRunStatus.Complete && graded.grade.complete ? RunStatus.Passed : RunStatus.Failed),
	});
	if ('error' in result) console.error(result.error);
	const grade = 'grade' in result ? result.grade : undefined;
	if (!grade || !result.gradePath) return exitCli({ code: 1 });
	console.log(`plan grade ${name} — ${grade.grade}; ${grade.complete ? 'complete' : 'incomplete'}`);
	if (grade.incompleteReason) console.log(grade.incompleteReason);
	console.log(`generation: ${grade.workflow?.generation ?? 'unavailable'}; scope: ${grade.scope}`);
	console.log(`independent coverage: ${grade.workflow?.coverageReceiptIds.length ?? 0} receipt(s); checked: ${grade.phasesChecked.join(', ') || 'none'}`);
	for (const finding of grade.structural) printStructuralFinding({ finding });
	for (const finding of grade.workflow?.findings ?? []) printPlanningFinding({ finding });
	console.log(`grade: ${result.gradePath}`);
	return exitCli({ code: grade.complete ? 0 : 1 });
};

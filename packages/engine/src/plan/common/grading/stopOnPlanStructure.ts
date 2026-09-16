import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { GradeReport, StructuralFinding } from '#src/contracts/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { createGradeReport } from '#src/plan/common/grading/createGradeReport.ts';
import type { GradeStamp } from '#src/plan/common/types/GradeStamp.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';

export const stopOnPlanStructure = async ({
	params,
	gradePath,
	structural,
	blocking,
	stamp,
	progress,
}: {
	params: PlanGradeParams;
	gradePath: string;
	structural: StructuralFinding[];
	blocking: number;
	stamp: GradeStamp;
	progress: (message: string) => void;
}): Promise<GradeReport> => {
	const report = createGradeReport({
		name: params.name,
		phases: params.phases,
		structural,
		gaps: [],
		failures: [`${blocking} blocking structural finding(s) — the semantic readers were not launched`],
		phasesChecked: [],
		commit: stamp.commit,
		treeDirty: stamp.treeDirty,
		phasesRequired: [],
		documentationComplete: false,
	});

	await writeJsonFile({ path: gradePath, value: report });
	await appendGradeHistory({ cwd: params.cwd, name: params.name, report });
	progress(`plan grade ${params.name}: ${blocking} blocking structural finding(s) — stopped before any agent was spawned`);

	return report;
};

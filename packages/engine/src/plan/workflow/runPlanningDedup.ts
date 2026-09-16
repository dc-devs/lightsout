import { join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { DedupReport } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { adoptPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/adoptPlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { collectPlanningPriorArt, runPlanningGrade } from '#src/plan/workflow/review/index.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

export const runPlanningDedup = async ({
	runtime,
}: {
	runtime: PlanningRuntime;
}): Promise<
	| { status: typeof PlanRunStatus.Complete; workspaceDir: string; dedup: DedupReport; dedupPath: string }
	| { status: typeof PlanRunStatus.Failed; workspaceDir: string; error: string }
> => {
	const workspaceDir = join(runtime.cwd, '.lightsout', 'plans', runtime.name);
	const snapshot = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!snapshot) return { status: PlanRunStatus.Failed, workspaceDir, error: 'Canonical planning input is unavailable' };
	const adopted = await adoptPlanningExecutionPolicy({ runtime, snapshot });
	const current = await collectPlanningPriorArt({ runtime, snapshot: adopted });
	const dedupPath = join(workspaceDir, 'dedup.json');
	const { grade } = await runPlanningGrade({ runtime });
	const dedup: DedupReport = {
		planName: runtime.name,
		findings: [],
		reviewed: [],
		complete: grade.passed,
		...(grade.passed ? {} : { incompleteReason: grade.incompleteReason ?? 'Current canonical investigation and independent coverage remain incomplete.' }),
		reviewedAt: new Date().toISOString(),
		workflow: {
			format: 'planning-dedup-v1',
			generation: grade.workflow?.generation ?? current.digest,
			observationArtifacts: current.record.artifacts.filter((artifact) => artifact.path.startsWith('planning-prior-art/')).map((artifact) => artifact.path),
			findingIds: grade.workflow?.findings.map((finding) => finding.id) ?? [],
			coverageReceiptIds: grade.workflow?.coverageReceiptIds ?? [],
		},
	};
	await writeJsonFile({ path: dedupPath, value: dedup });
	return { status: PlanRunStatus.Complete, workspaceDir, dedup, dedupPath };
};

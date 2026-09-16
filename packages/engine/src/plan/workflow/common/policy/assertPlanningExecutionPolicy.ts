import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { readPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/readPlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
}

/** Transactions cannot adopt a competing process's policy after entry. */
export const assertPlanningExecutionPolicy = ({ runtime, snapshot }: Params): void => {
	const current = readPlanningExecutionPolicy({ snapshot, stage: runtime.stage });
	if (!runtime.executionPolicy && !current) return;
	if (!runtime.executionPolicy) throw new Error('Planning runtime lacks the adopted execution policy');
	if (canonicalJson({ value: current?.reference }) !== canonicalJson({ value: runtime.executionPolicy.reference }))
		throw new Error('Planning execution policy changed; stop and resume with the selected policy before continuing');
};

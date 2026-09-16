import { PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { assertPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/assertPlanningExecutionPolicy.ts';
import { buildPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/buildPlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	driver: Driver;
	work: PlanningWork;
	standards: PlanningStandards;
}

/** Formatting retries remain subject to live ownership and the same captured provider and policy. */
export const assertPlanningDispatch = async ({ runtime, driver, work, standards }: Params): Promise<void> => {
	if (runtime.driver !== driver || work.stage !== runtime.stage) throw new Error('Planning dispatch provider or stage changed after preparation');
	const snapshot = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!snapshot) throw new Error('Planning generation disappeared before dispatch');
	assertPlanningExecutionPolicy({ runtime, snapshot });
	const active = snapshot.record.work.find((item) => item.id === work.id);
	if (
		!active?.currentAttemptId ||
		active.status !== PlanningVocabulary.WorkState.Running ||
		active.currentAttemptId !== work.currentAttemptId ||
		active.inputDigest !== work.inputDigest
	)
		throw new Error('Planning dispatch lost its active attempt');
	if (runtime.executionPolicy && buildPlanningExecutionPolicy({ runtime, standards }).reference.sha256 !== runtime.executionPolicy.reference.sha256)
		throw new Error('Planning dispatch execution policy changed after preparation');
	await runtime.lease.renew({ attemptId: active.currentAttemptId });
};

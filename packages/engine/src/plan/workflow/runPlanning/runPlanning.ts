import { randomUUID } from 'node:crypto';
import { type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { adoptPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/adoptPlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { ensurePlanningInput } from '#src/plan/workflow/input/index.ts';
import { executePlanningWork } from '#src/plan/workflow/runPlanning/common/utils/executePlanningWork.ts';
import { finishPlanningCycle } from '#src/plan/workflow/runPlanning/common/utils/finishPlanningCycle.ts';
import { refreshPlanningCycle } from '#src/plan/workflow/runPlanning/common/utils/refreshPlanningCycle.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
}

/** Restore, claim, dispatch and verify until every obligation closes or a concrete user/external decision prevents progress. */
export const runPlanning = async ({ runtime }: Params): Promise<PlanningRunResult> => {
	let cycleId: string = randomUUID();
	let snapshot = await ensurePlanningInput({ runtime });
	if (snapshot.record.sources.length === 0)
		return {
			status: PlanningVocabulary.Status.ExternallyBlocked,
			name: runtime.name,
			generation: snapshot.digest,
			continuation: runtime.name,
			cause: 'Original planning input is missing; capture the requested feature before invoking an agent.',
		};
	snapshot = await adoptPlanningExecutionPolicy({ runtime, snapshot });
	for (;;) {
		const cycle = await refreshPlanningCycle({ runtime, snapshot, cycleId });
		snapshot = cycle.snapshot;
		cycleId = cycle.cycleId;
		if (cycle.result) return cycle.result;
		if (cycle.recovered) continue;
		if (cycle.readiness?.ready) {
			const latest = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
			if (!latest) throw new Error('Planning generation disappeared before completion');
			if (latest.digest !== snapshot.digest) {
				snapshot = latest;
				continue;
			}
		}
		const complete = await finishPlanningCycle({ runtime, cycle });
		if (complete) return complete;
		const executed = await executePlanningWork({ runtime, cycle });
		snapshot = executed.snapshot;
		if (executed.result) return executed.result;
	}
};

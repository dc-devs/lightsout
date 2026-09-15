import type { PlanningReadiness, PlanningRunResult, StructuralFinding } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

/** One refreshed scheduler observation; only a current derived readiness can supply completion. */
export interface PlanningCycle {
	snapshot: PlanningSnapshot;
	cycleId: string;
	structural: StructuralFinding[];
	readiness?: PlanningReadiness;
	result?: PlanningRunResult;
	recovered: boolean;
}

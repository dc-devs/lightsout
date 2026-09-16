import type { PlanningRecord } from '#src/contracts/index.ts';
import type { PlanningOmittedObservation } from '#src/plan/workflow/common/types/transport/PlanningOmittedObservation.ts';

/** One verified generation; projections and later commits cannot alter these resolved bytes. */
export interface PlanningSnapshot {
	record: PlanningRecord;
	digest: string;
	artifacts: ReadonlyMap<string, string>;
	omittedObservations?: PlanningOmittedObservation[];
}

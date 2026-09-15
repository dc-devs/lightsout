import type { PlanningDependency } from '#src/contracts/index.ts';
import type { PlanningStandardsChannel } from '#src/plan/workflow/common/types/PlanningStandardsChannel.ts';
import type { PlanningStandardsObservation } from '#src/plan/workflow/common/types/PlanningStandardsObservation.ts';

/** Pure acquisition result, including bytes rather than only their hashes. */
export interface PlanningStandards {
	content: string;
	channels: PlanningStandardsChannel[];
	dependencies: PlanningDependency[];
	observations: PlanningStandardsObservation[];
	policyDigest: string;
}

import type { PlanningObservation } from '#src/plan/workflow/common/types/transport/PlanningObservation.ts';
import type { PlanningObservationResult } from '#src/plan/workflow/common/types/transport/PlanningObservationResult.ts';

interface Params {
	observations: PlanningObservationResult[];
}

/** Dispatch and acceptance require actual source bytes from the current attempt. */
export const requirePlanningObservationContent = ({ observations }: Params): PlanningObservation[] =>
	observations.map((observation) => {
		if (!observation.available) throw new Error('Planning source must be reacquired before dispatch or acceptance');
		const { available: _available, ...value } = observation;
		return value;
	});

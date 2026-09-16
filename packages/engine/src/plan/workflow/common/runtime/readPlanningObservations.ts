import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningObservation } from '#src/plan/workflow/common/types/transport/PlanningObservation.ts';
import type { PlanningObservationResult } from '#src/plan/workflow/common/types/transport/PlanningObservationResult.ts';

interface Params {
	snapshot: PlanningSnapshot;
	paths: string[];
}

/** Resolve exact persisted observations; missing or malformed continuation data is an integrity failure. */
export const readPlanningObservations = ({ snapshot, paths }: Params): PlanningObservationResult[] =>
	paths.map((path) => {
		const content = snapshot.artifacts.get(path);
		if (content !== undefined) return { ...PlanningObservation.parse(JSON.parse(content)), available: true };
		const descriptor = snapshot.record.artifacts.find((item) => item.path === path);
		const omitted = snapshot.omittedObservations?.find((item) => item.path === path && item.sha256 === descriptor?.sha256);
		if (!omitted) throw new Error(`Missing planning observation: ${path}`);
		return { ...omitted.observation, available: false };
	});

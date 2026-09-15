import type { PlanningStandardsBundle } from '#src/contracts/index.ts';

/** Parser IO proof persisted once with the bundle; external paths remain provenance. */
export type PlanningStandardsObservation = PlanningStandardsBundle['observations'][number];

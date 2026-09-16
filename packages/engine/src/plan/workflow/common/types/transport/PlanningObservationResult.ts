import type { PlanningObservation } from '#src/plan/workflow/common/types/transport/PlanningObservation.ts';

/** Unavailable portable evidence cannot be passed to a model as if its source were read. */
export type PlanningObservationResult = ({ available: true } & PlanningObservation) | ({ available: false } & Omit<PlanningObservation, 'content'>);

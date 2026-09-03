import type { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';

/**
 * The lifecycle half of the `queue` config block with every default already
 * applied, exactly as `QueueSettings` and `ShipSettings` are resolved.
 *
 * It lives outside the queue because the command edge writes these two fields
 * too, and a manual entry point must not have to build a queue to record what
 * a ticket owes and where it sits.
 */
export interface LifecycleSettings {
	/** The tracker label naming each planning status, defaults applied. */
	planningStatusLabels: Record<PlanningStatus, string>;
	/** The tracker's own name for each status role, defaults applied. */
	statusNames: Record<TrackerStatusRole, string>;
	/** Statuses a ticket may be in for the queue to pick it up, default applied. */
	eligibleStatuses: string[];
}

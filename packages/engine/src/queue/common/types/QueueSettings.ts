import type { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';

/**
 * The `queue` config block with every default already applied.
 *
 * Resolved once at the edge so no step downstream re-decides one, exactly as
 * `ShipSettings` is: a queue handed these may assume they are usable.
 *
 * Tracker identity is not here: it is a `TrackerSettings`, resolved from the
 * `ticket-tracker` block and carried beside these settings, so the queue's own
 * behaviour and the tracker's address are never one object again.
 */
export interface QueueSettings {
	/** The ticket label naming each route. */
	routeLabels: Record<QueueRoute, string>;
	maxParallel: number;
	/** Statuses a ticket may be in to be picked up. */
	eligibleStatuses: string[];
	/** Status a picked-up ticket is moved to. */
	inProgressStatus: string;
	/** Command run once in a fresh worktree; undefined when the repo needs none. */
	setup?: string;
	/** Branch-name template with `{ticket}` and `{slug}` tokens, default applied. */
	branchTemplate: string;
	/** The ticket-body heading relayed answers land under, default applied. */
	decisionsHeading: string;
	/** Ceiling for one ticket's auto-plan worker session in milliseconds, parsed from `worker-timeout`. */
	workerTimeoutMs: number;
	/** How long one relayed question waits before the ticket parks, in milliseconds, parsed from `question-timeout`. Only the file relay observes it. */
	questionTimeoutMs: number;
	/** The ticket label set on park and cleared on resume or ship; undefined when the repo opted out. */
	parkedLabel?: string;
}

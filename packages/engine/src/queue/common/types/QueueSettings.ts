import type { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';

/**
 * The `queue` config block with every default already applied and the API key
 * already read out of the environment.
 *
 * Resolved once at the edge so no step downstream re-decides one, exactly as
 * `ShipSettings` is: a queue handed these may assume they are usable.
 *
 * There is no `tracker` field. The block's `tracker` key exists so a second
 * adapter can be named later, and while `linear` is the only literal it accepts
 * there is nothing for a resolved setting to vary on.
 */
export interface QueueSettings {
	/** The tracker's team key. */
	team: string;
	/** The ticket label naming each route. */
	routeLabels: Record<QueueRoute, string>;
	maxParallel: number;
	/** The key itself, read from the configured environment variable. Never logged. */
	apiKey: string;
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

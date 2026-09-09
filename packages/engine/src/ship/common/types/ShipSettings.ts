import type { ShipMergeMethod } from '#src/contracts/index.ts';

/**
 * The `ship` config block with every default already applied.
 *
 * Resolved once at the edge so no step downstream re-decides one: a pattern
 * compiled here is a pattern every reader agrees on, and a `runShip` handed
 * these may assume they are valid.
 */
export interface ShipSettings {
	/** Compiled from the config's `ticket-pattern` source. */
	ticketPattern: RegExp;
	/** The `pr-body` template, tokens unsubstituted. */
	pullRequestBody: string;
	mergeMethod: ShipMergeMethod;
	/** Whether a passed implement run chains into ship without `--ship`. */
	afterImplement: boolean;
	/** The `pre-ship` command, run against the freshly fetched base before verification. Undefined when the repo has no such convention. */
	preShip: string | undefined;
	/** Whether a readable, genuinely empty check list may merge. Resolved once at the edge and immutable for the invocation, repairs included. */
	allowNoCi: boolean;
}

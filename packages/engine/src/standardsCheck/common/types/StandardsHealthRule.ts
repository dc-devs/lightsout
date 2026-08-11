import type { StandardsSet } from '@/contracts';

/**
 * One rule's health: whether code checks it, and how the agents that met its
 * findings responded.
 *
 * Blocking sites and advice are counted separately and never mixed. They are
 * recorded by different mechanisms — a blocking site's fate is re-checked on
 * disk, while advice has only the agent's own word for it — and one combined
 * number would let the stronger evidence hide behind the weaker.
 */
export interface StandardsHealthRule {
	id: string;
	set: StandardsSet;
	documentPath: string;
	checked: boolean;
	/** Blocking sites frozen into refactor worklists that named this rule. */
	attempted: number;
	/** Frozen sites a batch report shows gone afterwards. */
	resolved: number;
	/** Frozen sites still present in a batch the agent declined. */
	declined: number;
	/** Sites whose fate no parsed report records — failed or aborted batches, and remainders under any other outcome. */
	untracked: number;
	/** Advisory and review findings this rule's advice was taken on. */
	adviceApplied: number;
	/** Advisory and review findings this rule's advice was declined on. */
	adviceDeclined: number;
	/** Rationale from batches that left this rule's sites standing, plus each declined advice's reason. */
	reasons: string[];
}

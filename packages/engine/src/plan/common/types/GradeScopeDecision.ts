import type { GradeScope } from '#src/contracts/index.ts';

/** What one grade pass was told to cover, and why. */
export interface GradeScopeDecision {
	scope: GradeScope;
	/** The plan-file basenames the readers cover. Every file for a full pass; the closure for a focused one. */
	phases: string[];
	/** True when a qualifying passing full review already covers these inputs, so nothing is spawned and nothing is written. Only ever set with `scope: 'full'`. */
	reuse: boolean;
	/** One line naming the rule that chose this scope — recorded on the report and printed at the terminal. */
	reason: string;
}

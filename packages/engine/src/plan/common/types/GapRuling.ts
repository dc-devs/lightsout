import type { GapGroupVerdict, GapObservation } from '#src/contracts/index.ts';

/** What the batch accounting decided about one observation, before the join writes it onto its gap. */
export interface GapRuling {
	/** The ruling that covers this observation, absent when the accounting refused every candidate. */
	verdict?: GapGroupVerdict;
	/** Shared by every observation one multi-observation verdict covered; absent on a single ruling. */
	groupId?: string;
	/** Every observation that verdict covered, so the fold can open one record holding all of them. Absent on a single ruling. */
	observations?: GapObservation[];
	/** The citation for this observation's own plan file, taken from the verdict's `answers`. */
	answerAt?: string;
	/** Why nobody settled this observation, absent when a ruling stands. */
	unjudgedReason?: string;
}

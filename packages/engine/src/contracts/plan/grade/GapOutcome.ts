/**
 * Who settles one reader finding — the judge's answer, and the only thing the
 * grade's gap half gates on. `needs-a-human` blocks; `agent-can-decide` and
 * `already-answered` are recorded, print as notes, and gate nothing.
 *
 * `unjudged` is not the judge's to return. The engine stamps it on a finding no
 * judge settled — its spawn failed, it answered without the evidence its
 * outcome demands, or the fan-out stopped before it started — and it blocks like
 * `needs-a-human`. Failing closed costs one extra question; failing open lets an
 * unweighed finding pass as a clean bill.
 */
export const GapOutcome = {
	NeedsAHuman: 'needs-a-human',
	AgentCanDecide: 'agent-can-decide',
	AlreadyAnswered: 'already-answered',
	Unjudged: 'unjudged',
} as const;

export type GapOutcome = (typeof GapOutcome)[keyof typeof GapOutcome];

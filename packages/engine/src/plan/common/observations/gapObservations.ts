import type { GapObservation, GradedGap } from '#src/contracts/index.ts';

interface Params {
	/** A judged gap, or a memory record — a record is a gap the memory carried across passes, and reads the same way. */
	gap: GapObservation & Pick<GradedGap, 'observations'>;
}

/**
 * Every observation one gap stands for: the list it carries, or — when it carries
 * none, as a single reader's finding or a record written before grouping existed
 * does — the one observation its own identity fields describe.
 *
 * Spelled once because the batch accounting, the report collapse and the memory
 * fold all need a gap's observations and must agree on what an empty list means:
 * a copy that read empty as "nothing" would let a finding's own location drop out
 * of the record it joins.
 */
export const gapObservations = ({ gap }: Params): GapObservation[] =>
	gap.observations.length > 0
		? gap.observations
		: [{ phase: gap.phase, lens: gap.lens, area: gap.area, gap: gap.gap, decision: gap.decision, options: gap.options }];

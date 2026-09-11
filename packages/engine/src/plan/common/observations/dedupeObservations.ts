import type { GapObservation } from '#src/contracts/index.ts';
import { collapseText } from '#src/plan/common/memory/collapseText.ts';

interface Params {
	observations: GapObservation[];
}

/**
 * Observations in their original order with repeats dropped, where a repeat is
 * the same plan file, lens, area and gap wording — the last compared after
 * collapsing whitespace and case, which move freely between two re-typings of
 * one line and mean nothing.
 *
 * Spelled once because the batch accounting, the report collapse and the memory
 * fold each union several findings' observations, and two copies of what counts
 * as the same observation would let one stage keep a duplicate the next drops.
 */
export const dedupeObservations = ({ observations }: Params): GapObservation[] => {
	const seen = new Set<string>();

	return observations.filter((observation) => {
		const key = JSON.stringify([observation.phase, observation.lens, observation.area, collapseText({ text: observation.gap })]);
		const repeat = seen.has(key);

		seen.add(key);

		return !repeat;
	});
};

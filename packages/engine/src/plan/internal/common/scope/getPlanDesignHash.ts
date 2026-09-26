import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { ParsedPlan } from '#src/plan/internal/common/types/ParsedPlan.ts';

interface Params {
	/** The parsed plan file whose design text is hashed. */
	plan: ParsedPlan;
	/**
	 * Generated-region headings kept in the hash although the shared list names
	 * them, because on this call nothing else measures their content — the
	 * overview's two per-phase sections when attribution failed. Empty for every
	 * other call.
	 */
	keepRegions?: string[];
	/**
	 * Text hashed beside this file's own design text because it describes this
	 * file though it lives in the overview. Empty when there is none.
	 */
	attributed?: string;
}

/**
 * The spans this hash leaves out, widest line first — the engine-generated
 * regions `plan.generatedRegionRanges` located, minus the ones this call keeps.
 * Removing them from the last one back means an earlier removal never shifts the
 * lines a later one names.
 */
const droppedRanges = ({ plan, keepRegions }: { plan: ParsedPlan; keepRegions: string[] }) =>
	[...plan.generatedRegionRanges]
		.filter(([heading]) => !keepRegions.includes(heading))
		.map(([, range]) => range)
		.sort((left, right) => right.start - left.start);

/**
 * The hash of the text a reader of this plan file actually read: its content
 * with every engine-generated region removed, taken together with the text that
 * describes this file though it lives elsewhere.
 *
 * The regions are read from the parse rather than compared by heading here, so a
 * region the shared list gains later reaches this measurement with no edit — the
 * whole reason that list exists. A generated region is derived from a record the
 * fingerprint already measures row by row, so hashing it as well would report a
 * recorded reading as stale for a reason no reader could act on.
 *
 * The two texts are hashed over their canonical encoding rather than
 * concatenated: concatenation would let a design text ending in what the
 * attributed text begins with collide with a different split of the same
 * characters.
 */
export const getPlanDesignHash = ({ plan, keepRegions = [], attributed = '' }: Params): string => {
	const design = [...plan.lines];

	for (const { start, end } of droppedRanges({ plan, keepRegions })) {
		design.splice(start - 1, end - start + 1);
	}

	return sha256({ content: canonicalJson({ value: { design: design.join('\n'), attributed } }) });
};

import type { GradedGap } from '#src/contracts/index.ts';

/** Everything one gap-judge spawn is given: the findings it rules on under the identifiers the engine assigned, and the text of every plan file they span. */
export interface GapBatch {
	/** The observations this judge rules on: the engine's id, the finding's position in the pass's gap array, and the gap itself. */
	observations: Array<{ id: string; index: number; gap: GradedGap }>;
	/** One entry per location the batch spans — the union of `findingLocations` over its gaps — in first-appearance order; the text the judge reads and each citation is confirmed against. */
	planTexts: Array<{ phase: string; text: string }>;
}

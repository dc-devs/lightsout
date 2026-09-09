import type { StandardsFinding } from '#src/contracts/index.ts';

/**
 * A run's deterministic findings split by where they came from — the four
 * answers `attributeStandardsFindings` can give about a site on a changed file.
 *
 * A named type rather than an inline return shape because the refactor step's
 * work-list helper hands the whole partition on, and a hand-copied shape at
 * that hop is a shadow contract that drifts.
 */
export interface AttributedFindings {
	/** Site keys the baseline never carried. */
	introduced: StandardsFinding[];
	/** Site keys the baseline carried, with a larger measure now. */
	worsened: StandardsFinding[];
	/** Site keys the baseline carried, with an equal or smaller measure now. */
	inherited: StandardsFinding[];
	/** No comparison was possible: no baseline, or no measure on both sides. */
	uncertain: StandardsFinding[];
}

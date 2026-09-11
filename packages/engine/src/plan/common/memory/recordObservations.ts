import type { GapObservation, GradeFindingRecord } from '#src/contracts/index.ts';
import { gapObservations } from '#src/plan/common/observations/gapObservations.ts';

interface Params {
	record: GradeFindingRecord;
}

/**
 * Every observation a durable record holds — including for a record written
 * before grouping existed, which reads as exactly one observation built from its
 * own phase, lens, area, gap, decision and options.
 *
 * No group is ever inferred from stored text, hashes or matching symbols: an old
 * record joins a group only when a new judge ruling names it. The empty-list rule
 * is `gapObservations`'s, so a record and the gap it was opened from can never
 * read one list two ways.
 */
export const recordObservations = ({ record }: Params): GapObservation[] => gapObservations({ gap: record });

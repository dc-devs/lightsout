import type { GradeFindingRecord, GradeFindingStatus, GradeMemory } from '#src/contracts/index.ts';
import { recordObservations } from '#src/plan/common/memory/recordObservations.ts';

interface Params {
	memory: GradeMemory;
	/** A plan file's basename. */
	phase: string;
	/** When given, keep only records in these states. Absent keeps every state. */
	statuses?: GradeFindingStatus[];
}

/**
 * The records touching one plan file — any record one of whose observations
 * sits in it, not only the one its representative names — optionally narrowed
 * to a set of states.
 *
 * A grouped record is therefore returned for each of its locations, so a caller
 * asking about several plan files at once must de-duplicate by record id.
 *
 * Spelled once because the reader's settled list and the judge's record list
 * must be cut the same way: two hand-rolled filters would agree only by
 * accident, and one drifting would show a reader a record the judge never
 * sees.
 */
export const phaseFindingRecords = ({ memory, phase, statuses }: Params): GradeFindingRecord[] =>
	memory.findings.filter((record) => {
		const touches = recordObservations({ record }).some((observation) => observation.phase === phase);

		return touches && (statuses === undefined || statuses.includes(record.status));
	});

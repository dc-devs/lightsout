import type { GradeFindingRecord, GradeFindingStatus, GradeMemory } from '#src/contracts/index.ts';

interface Params {
	memory: GradeMemory;
	/** A plan file's basename. */
	phase: string;
	/** When given, keep only records in these states. Absent keeps every state. */
	statuses?: GradeFindingStatus[];
}

/**
 * The records raised against one plan file, optionally narrowed to a set of
 * states.
 *
 * Spelled once because the reader's settled list and the judge's record list
 * must be cut the same way: two hand-rolled filters would agree only by
 * accident, and one drifting would show a reader a record the judge never
 * sees.
 */
export const phaseFindingRecords = ({ memory, phase, statuses }: Params): GradeFindingRecord[] =>
	memory.findings.filter((record) => record.phase === phase && (statuses === undefined || statuses.includes(record.status)));

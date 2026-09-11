import { type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';

interface Params {
	record: GradeFindingRecord;
	/** Why the record is unanswered again — what a human reads in its `reopened` history. */
	reason: string;
	/** The pass timestamp. */
	at: string;
}

/**
 * A record unanswered again: `open`, every stored citation cleared, seen this
 * pass, and a `reopened` entry saying why and what state it left.
 *
 * Spelled once because a lost citation, a contrary ruling, a new unverified
 * location and an absorbed obligation all reopen a record, and a copy that forgot
 * to clear one of the two citation fields would leave a closure nobody checks.
 */
export const reopenRecord = ({ record, reason, at }: Params): GradeFindingRecord => ({
	...record,
	status: GradeFindingStatus.Open,
	resolution: undefined,
	resolutions: [],
	lastSeen: at,
	reopened: [...record.reopened, { at, reason, priorStatus: record.status }],
});

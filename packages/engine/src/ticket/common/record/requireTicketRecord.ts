import { describeMissingTicketRecord } from '#src/common/utils/describeMissingTicketRecord.ts';
import type { TicketRecord } from '#src/contracts/index.ts';

interface Params {
	record: TicketRecord | undefined;
	ticketBranch: string;
}

/**
 * The record a change is about to be made to, or the one sentence saying why
 * there is no change to make.
 *
 * Two refusals, and every record-changing subcommand owes both. A ticket with
 * no record at all is either one nobody has started or a folder shaped before
 * ticket records existed, and the two commands named are the way out of each. A
 * record carrying `shipped` is history: any change to it could only re-open
 * shipping or misdescribe what shipped, so it is refused whatever the change
 * was. `show` and `sync` never ask here, which is what keeps a merged ticket
 * readable.
 */
export const requireTicketRecord = ({ record, ticketBranch }: Params): TicketRecord | { error: string } => {
	if (record === undefined) {
		return { error: describeMissingTicketRecord({ ticketBranch }) };
	}

	return record.shipped === undefined
		? record
		: { error: `ticket ${ticketBranch} shipped as ${record.shipped.mergeCommit}, and a shipped ticket's record is history that no longer changes` };
};

import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';

interface Params {
	outcome: TicketRunOutcome;
}

/**
 * Whether one ticket's outcome is a park: not ready to merge, and not merely
 * left open.
 *
 * Said in one place because three consequences read it — the parked label, the
 * coordinator run's status and the command's exit code — and a ticket the queue
 * left open must look the same to all three: it is waiting on a human decision
 * rather than on a re-run.
 *
 * @returns true when the outcome is work a human has to look at
 */
export const isParkedOutcome = ({ outcome }: Params): boolean => !outcome.ready && outcome.open === undefined;

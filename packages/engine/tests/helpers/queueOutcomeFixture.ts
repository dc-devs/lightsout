import type { TicketRunOutcome } from '#src/queue/index.ts';

/** A worker result with stable branch and worktree names, optionally failed or parked. */
export const queueOutcomeFixture = ({
	ticket,
	...overrides
}: { ticket: TicketRunOutcome['ticket'] } & Partial<Omit<TicketRunOutcome, 'ticket'>>): TicketRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready: true,
	...overrides,
});

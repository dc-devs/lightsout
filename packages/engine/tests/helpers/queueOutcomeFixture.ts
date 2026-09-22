import type { WorkOrderRunOutcome } from '#src/queue/index.ts';

/** A worker result with stable branch and worktree names, optionally failed or parked. */
export const queueOutcomeFixture = ({
	ticket,
	...overrides
}: { ticket: WorkOrderRunOutcome['ticket'] } & Partial<Omit<WorkOrderRunOutcome, 'ticket'>>): WorkOrderRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready: true,
	...overrides,
});

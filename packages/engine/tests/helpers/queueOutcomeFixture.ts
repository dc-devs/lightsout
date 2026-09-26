import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';

/** A worker result with stable label, branch and worktree names, optionally failed or parked. */
export const queueOutcomeFixture = ({
	ticket,
	...overrides
}: { ticket: WorkOrderRunOutcome['ticket'] } & Partial<Omit<WorkOrderRunOutcome, 'ticket'>>): WorkOrderRunOutcome => ({
	ticket,
	name: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready: true,
	...overrides,
});

import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

/** How one identifier's task is told to end: ready-or-merged, plainly failed, or parked on a question nobody answered. */
const PlannedEnd = { Ready: 'ready', Failed: 'failed', Unanswered: 'unanswered' } as const;
type PlannedEnd = (typeof PlannedEnd)[keyof typeof PlannedEnd];

interface EndParams {
	identifier: string;
	end?: PlannedEnd;
	error?: string;
}

export const drainLaneOutcomeFixture = ({ identifier, end = PlannedEnd.Ready, error }: EndParams): WorkOrderRunOutcome => ({
	ticket: queueTicketFixture({ identifier, id: `id-${identifier}`, title: `Ticket ${identifier}` }),
	name: `${identifier.toLowerCase()}-work`,
	branch: `${identifier.toLowerCase()}-work`,
	worktreePath: `/tmp/${identifier}`,
	ready: end === PlannedEnd.Ready,
	error: end === PlannedEnd.Ready ? undefined : (error ?? 'stopped'),
	unanswered: end === PlannedEnd.Unanswered ? true : undefined,
});

import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { TicketRunOutcome } from '#src/queue/index.ts';

type Ticket = TicketRunOutcome['ticket'];
type RunnableTicket = Ticket & { worker: NonNullable<Ticket['worker']> };

/** A ready direct ticket; each scenario overrides only the facts it exercises. */
export const queueTicketFixture = ({ number = 70, ...overrides }: { number?: number } & Partial<RunnableTicket> = {}): RunnableTicket => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: 'direct',
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
	...overrides,
});

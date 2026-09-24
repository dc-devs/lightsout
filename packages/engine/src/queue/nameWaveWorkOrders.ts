import { messageOf } from '#src/common/utils/messageOf.ts';
import { type LightsoutConfig, WorkOrderMode } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import { createWorkOrder, findWorkOrderByTicketRef } from '#src/workOrder/index.ts';

interface Params {
	/** The MAIN repository checkout — where the records live and where a new one is written. */
	cwd: string;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never mutates `process.env`. */
	env: NodeJS.ProcessEnv;
	/** The harness the name summariser spawns, so a queued work order is named exactly the way `work-order new` names one. */
	driver: Driver;
	/** The tickets this scan admitted, in the order they will be picked up. */
	tickets: RunnableTicket[];
	onProgress?: (message: string) => void;
}

/**
 * The mode a new record is created in, by the worker the queue selected.
 *
 * A ticket the queue builds from the ticket body has exactly one implementation,
 * which is what single-plan mode describes, so its record starts there whatever
 * the repository default says; an auto-plan ticket is planned first, so it keeps
 * the default. Keyed by every worker, so a new one is a type error until placed.
 */
const creationModeByWorker: Record<QueueWorker, WorkOrderMode | undefined> = {
	[QueueWorker.Direct]: WorkOrderMode.SinglePlan,
	[QueueWorker.Plan]: WorkOrderMode.SinglePlan,
	[QueueWorker.AutoPlan]: undefined,
};

/** The work order this ticket already has, or the one the single writer of a name just wrote — or the sentence saying neither happened. */
const nameOne = async ({ cwd, config, env, driver, ticket, onProgress }: Omit<Params, 'tickets'> & { ticket: RunnableTicket }) => {
	const existing = await findWorkOrderByTicketRef({ cwd, ticketRef: ticket.identifier });

	if (existing !== undefined) {
		return { name: existing.name, branch: existing.record.branch };
	}

	// A creation that FAILS is caught here rather than thrown: this runs inside
	// the drain's scan loop, so one tracker timeout or one lock it could not take
	// would otherwise end a whole wave.
	const created = await createWorkOrder({
		cwd,
		ticketRef: ticket.identifier,
		mode: creationModeByWorker[ticket.worker],
		config,
		env,
		driver,
		onProgress,
	}).catch((thrown: unknown) => ({
		error: `no work order could be created for ${ticket.identifier}: ${messageOf({ error: thrown })}`,
	}));

	return 'error' in created ? created : { name: created.name, branch: created.branch };
};

/**
 * The one step in a drain that settles names, run once per scan before any
 * worktree is built.
 *
 * For each ticket in order it asks for the work order that already carries that
 * ticket reference and takes its label and branch as stored; only a ticket with
 * no work order at all reaches `createWorkOrder`, which is the one writer of a
 * name. A ticket that could not be named — refused, or failed — becomes a
 * left-behind entry and the drain never builds it: the queue does not invent a
 * name for work the one writer declined to name, and a left-behind entry is
 * already how every other per-ticket problem in a drain is reported.
 *
 * A record the queue creates for a ticket it builds from the ticket body is
 * created in single-plan mode whatever `plan.default-work-order-mode` says; an
 * auto-plan ticket's record keeps the repository default.
 *
 * It is sequential rather than parallel: creation writes a record under its own
 * lock and a name collision has to be refused against every name already
 * allocated, which two concurrent creations could not see.
 */
export const nameWaveWorkOrders = async ({
	cwd,
	config,
	env,
	driver,
	tickets,
	onProgress,
}: Params): Promise<{ named: NamedWorkOrder[]; leftBehind: LeftBehindTicket[] }> => {
	const named: NamedWorkOrder[] = [];
	const leftBehind: LeftBehindTicket[] = [];

	for (const ticket of tickets) {
		const settled = await nameOne({ cwd, config, env, driver, ticket, onProgress });

		if ('error' in settled) {
			onProgress?.(`${ticket.identifier} · ${settled.error}`);
			leftBehind.push({ identifier: ticket.identifier, title: ticket.title, url: ticket.url, reason: settled.error });
		} else {
			named.push({ ticket, name: settled.name, branch: settled.branch });
		}
	}

	return { named, leftBehind };
};

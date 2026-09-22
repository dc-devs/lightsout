import type { WorkOrderListing } from '#src/workOrder/common/types/WorkOrderListing.ts';
import { listWorkOrders } from '#src/workOrder/listWorkOrders.ts';

interface Params {
	/** Any checkout of the repository: the records this machine holds are found from it. */
	cwd: string;
	/** The ticket reference to look for, in whatever case the caller has it. */
	ticketRef: string;
}

/**
 * The work order carrying a given ticket reference, read from the records
 * rather than matched against a branch name.
 *
 * The comparison ignores case: a tracker writes `LO-158` and a branch template
 * writes `lo-158`, and both name one ticket. Undefined is the ordinary answer —
 * for a repository with no tracker, or for work nobody has created a record for
 * — so callers decide what absence means rather than being refused here.
 *
 * The first match wins if two records somehow carry one reference. That is a
 * repair job rather than something to resolve silently, and there is
 * deliberately no refusal for it here: nothing the engine does produces that
 * state, because `createWorkOrder` is the one writer and it asks this very
 * function before it composes anything. Keeping the refusal there is what
 * spares every other caller — each of which just wants the record for a
 * reference it already trusts — from handling one that cannot arise.
 */
export const findWorkOrderByTicketRef = async ({ cwd, ticketRef }: Params): Promise<WorkOrderListing | undefined> => {
	const { found } = await listWorkOrders({ cwd });
	const wanted = ticketRef.toLowerCase();

	return found.find((entry) => entry.record.ticketRef?.toLowerCase() === wanted);
};

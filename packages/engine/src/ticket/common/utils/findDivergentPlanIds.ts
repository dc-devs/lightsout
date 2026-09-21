import type { TicketRecord, TicketSyncState } from '#src/contracts/index.ts';

interface Params {
	record: TicketRecord;
	syncState: TicketSyncState | undefined;
}

/**
 * The plans whose published files this machine never published or restored:
 * the record names a commit marker the sidecar does not hold.
 *
 * A plan like that has been republished somewhere else since this machine last
 * saw it, so the folder here may be older than what the ticket carries.
 * Building it, or publishing over it, would lose the other machine's work
 * silently — so both refuse, and `lightsout work-order sync --keep` is what settles
 * which copy wins.
 */
export const findDivergentPlanIds = ({ record, syncState }: Params): string[] =>
	record.plans.filter((plan) => plan.publishedMarker !== undefined && plan.publishedMarker !== syncState?.planMarkers[plan.id]).map((plan) => plan.id);

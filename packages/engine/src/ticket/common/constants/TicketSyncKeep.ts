/**
 * Which copy of a diverged ticket record the human chose to keep.
 *
 * A divergence is never resolved by the engine: both copies hold real work, so
 * `lightsout work-order sync --keep` is how a person says which one wins. Keeping
 * the local copy republishes it over the ticket's; keeping the published copy
 * writes it into the primary checkout and restores the plans it names, setting
 * this machine's copies aside rather than deleting them.
 */
export const TicketSyncKeep = {
	Local: 'local',
	Published: 'published',
} as const;

export type TicketSyncKeep = (typeof TicketSyncKeep)[keyof typeof TicketSyncKeep];

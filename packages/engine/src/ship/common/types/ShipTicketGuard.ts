/**
 * The ticket record's say over shipping a branch, handed to `runShip` by its
 * caller.
 *
 * Required on `runShip` and on `runShipAttempt` for the reason
 * {@link ShipIntegration} is required: the compiler then refuses any shipping
 * path added later that omits the safety contract, so there is no way to merge a
 * branch without asking its ticket first.
 *
 * The implementation lives in the ticket module rather than here, because
 * reading and writing a ticket record needs `plan`, `brainstorm` and `ship`
 * itself — a `ship` that reached for it would close a cycle in the module graph.
 */
export interface ShipTicketGuard {
	/** Undefined when the branch may ship; otherwise the one sentence saying why it may not. */
	authorize: (params: { cwd: string; branch: string }) => Promise<string | undefined>;
	/** Records a confirmed merge on the branch's ticket record. Never rejects: the merge already happened. */
	recordShipped: (params: { cwd: string; branch: string; mergeCommit: string }) => Promise<void>;
}

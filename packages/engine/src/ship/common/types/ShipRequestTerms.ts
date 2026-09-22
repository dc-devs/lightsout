/**
 * What a branch's ticket record says about the shipping of one run, produced by
 * the ticket module's `readWorkOrderRunTerms` and carried through the CLI to
 * {@link resolveShipIntent}.
 *
 * The shape is declared here, in `ship`, because `ship` is the module that
 * consumes it and a `ticket` import from here would close a cycle in the module
 * graph — the same reason {@link ShipWorkOrderGuard} is declared here.
 *
 * A value of this type at all means the ticket's own record decides the run's
 * shipping; its absence means `--ship` and `ship.after-implement` decide it.
 */
export interface ShipRequestTerms {
	/** Why a passing run will not satisfy the ticket's ship request, or undefined when it will. */
	blocker: string | undefined;
}

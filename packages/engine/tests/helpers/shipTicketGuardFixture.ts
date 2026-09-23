import type { ShipWorkOrderGuard } from '#src/ship/index.ts';

/**
 * A ticket guard that authorizes everything and records nothing, for tests whose
 * subject is not the ticket record's say over the merge.
 *
 * One copy rather than one per test file, for the reason `shipIntegrationFixture`
 * is one copy: a test that IS about the guard hands in its own spy for whichever
 * member it is asking about, and the other member keeps the no-op default.
 */
export const shipTicketGuardFixture = (overrides: Partial<ShipWorkOrderGuard> = {}): ShipWorkOrderGuard => ({
	authorize: async () => undefined,
	recordShipped: async () => undefined,
	...overrides,
});

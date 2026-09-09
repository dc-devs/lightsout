/**
 * The tracker label a coordination timeout puts on a ticket, beside the
 * repository's own parked label.
 *
 * A constant the engine owns rather than a configuration key: the spelling is
 * settled, and every queue label starts with `queue-`. A key can be added later
 * without changing any behaviour, so adding one now would only widen the
 * interface. Only a human removes this label — nothing in the engine does.
 */
export const gateBlockedLabel = 'queue-blocked-gate-timed-out';

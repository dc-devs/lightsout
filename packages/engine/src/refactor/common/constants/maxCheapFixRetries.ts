/**
 * Mechanical fix attempts a red gate gets before the supervisor is consulted.
 *
 * Shared because the number is named in the escalation message as well as
 * spent in the loop, and a cap that said one thing and did another would be
 * read as the loop misbehaving.
 */
export const maxCheapFixRetries = 2;

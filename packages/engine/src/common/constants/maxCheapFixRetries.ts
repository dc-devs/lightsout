/**
 * Mechanical fix attempts a red gate gets before the run brings in judgment —
 * the supervisor where there is one, a failed batch where there is not.
 *
 * Shared because the number is named in the escalation message as well as
 * spent in the loop, and a cap that said one thing and did another would be
 * read as the loop misbehaving.
 */
export const maxCheapFixRetries = 2;

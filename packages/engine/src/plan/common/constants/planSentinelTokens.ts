/**
 * The values the plan template defines as "nothing to declare". They are
 * identifier-shaped, so every check reading backticked spans as names must skip
 * them: a declared absence is not a name being handed over. One declaration, so
 * a spelling the template adds reaches every check at once.
 */
export const planSentinelTokens = new Set(['none', 'None']);

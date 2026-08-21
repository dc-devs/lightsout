/**
 * Consecutive declined batches after which a run stops as systemic rather than
 * as one more per-batch judgment: at this many in a row the cause is far more
 * likely the setup (standards injection, gate config, unworkable source) than
 * the work, and further agent spend buys nothing.
 */
export const maxConsecutiveDeclines = 3;

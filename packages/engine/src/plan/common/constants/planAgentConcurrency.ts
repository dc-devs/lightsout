/**
 * How many read-only plan agents may be in flight at once across a whole pass —
 * every gap-checker of a grade run (every phase times every lens), and every
 * judge of a dedup run. Slots refill the moment one frees, so this is a steady
 * ceiling on concurrent harness spawns rather than a batch size.
 *
 * The bound is the API rate limit, not the machine: such an agent spends nearly
 * all its life waiting on its harness, and a rate-limited spawn ends the pass
 * incomplete for a human to re-run — the finished agents' work is persisted, but
 * the unvisited plan files still cost a second run. It sits above the draft's
 * ceiling because both of these are short read-only passes, not long authoring
 * turns, which is why `planDraftConcurrency` stays a separate number.
 */
export const planAgentConcurrency = 12;

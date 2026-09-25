/**
 * How many phase-authoring agents may be in flight at once in the phased
 * draft's fan-out. Slots refill the moment one frees, so this is a steady
 * ceiling on concurrent harness spawns rather than a batch size.
 *
 * The bound is the API rate limit, not the machine: a phase writer spends
 * nearly all its life waiting on its harness, and a rate-limited spawn parks the
 * whole draft for a human to resume — a wall-clock cost, which is the thing this
 * work is spending money to avoid.
 */
export const planDraftConcurrency = 8;

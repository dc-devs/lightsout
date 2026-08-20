/**
 * How many unit-test writers may be in flight at once in the write-tests
 * fan-out. Slots refill the moment one frees, so this is a steady ceiling on
 * concurrent harness spawns rather than a batch size.
 *
 * The bound is the API rate limit, not the machine: a writer spends nearly all
 * its life waiting on its harness, and a rate-limited spawn parks the whole run
 * for a human to resume — far more costly than the throughput a higher number
 * would buy.
 */
export const testWriterConcurrency = 10;

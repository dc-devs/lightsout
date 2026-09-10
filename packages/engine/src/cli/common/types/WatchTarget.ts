/**
 * What `resolveWatchTarget` settled on: the run a `--watch` should paint and
 * the family it belongs to, or the root ids of the families nothing can choose
 * between.
 *
 * Narrowed across a module boundary by both callers — `statusCommand` refuses
 * an ambiguous answer and `watchRunProgress` paints a resolved one — so the
 * shape is a contract rather than one function's private return.
 */
export type WatchTarget = { runId: string; rootRunId: string } | { ambiguous: string[] };

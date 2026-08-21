/**
 * What a batched run exits with when it stopped with work left and can be
 * picked up again — a `--max-batches` ceiling, or a harness rate-limit wall.
 *
 * Neither is a failure and neither is completion, and a caller has to tell all
 * three apart. Anything that broke still exits 1, so a script that only checks
 * for zero is no worse off than before.
 */
export const pausedExitCode = 2;

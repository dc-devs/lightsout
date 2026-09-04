/**
 * Ceiling for one gate command when `timeouts.gate-minutes` is not configured.
 *
 * Sized from what a slow gate costs rather than from what an agent may spend: a
 * gate is the repo's own suite, and this repository's end-to-end run spawns a
 * subprocess per test for nearly six minutes. Shared for the same reason the
 * agent ceilings are — the runner, the run header and the config view all state
 * it.
 */
export const defaultGateTimeoutMinutes = 15;

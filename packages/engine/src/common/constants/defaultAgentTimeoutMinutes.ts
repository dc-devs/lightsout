/**
 * Ceiling for a working agent's invocation when `timeouts.agent-minutes` is not
 * configured — the executor, the test writers, the refactorer and the fixes.
 *
 * One number rather than a copy per caller because the run state that enforces
 * it, the standalone review that sets its own bound, the run header that prints
 * it and the config view that reports it must agree: a header announcing sixty
 * minutes over a run bounded at something else is a lie nobody would catch.
 */
export const defaultAgentTimeoutMinutes = 60;

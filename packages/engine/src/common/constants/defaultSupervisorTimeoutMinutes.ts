/**
 * Ceiling for the read-only supervisor's invocation when
 * `timeouts.supervisor-minutes` is not configured.
 *
 * Shorter than the working roles' ceiling on purpose — the supervisor reads and
 * rules, it never edits — and shared for the same reason that one is: the
 * consultation, the run header and the config view all state it.
 */
export const defaultSupervisorTimeoutMinutes = 15;

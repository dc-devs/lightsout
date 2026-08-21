/**
 * A live run already holds the repo's run lock. Not a bug and not run state —
 * thrown before any manifest exists, so the CLI prints the message without a
 * stack and without leaving an orphan run directory.
 */
export class RunLockError extends Error {}

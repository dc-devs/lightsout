/**
 * No run on disk answers to the id a user typed. Not a bug and not a missing
 * file — the id itself is the mistake, so the CLI prints the message without a
 * stack rather than surfacing the path it tried to open.
 */
export class RunNotFoundError extends Error {}

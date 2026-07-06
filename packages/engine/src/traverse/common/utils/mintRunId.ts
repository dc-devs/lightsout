import { randomUUID } from 'node:crypto';

/**
 * A fresh run id: the ISO timestamp to the second (colons hyphenated) plus a
 * short random hash — `<iso-to-seconds>-<hash8>`. Lexicographic sort of ids IS
 * chronological, so the newest run is always last; the short hash only guards
 * same-second collisions.
 */
export const mintRunId = (): string => `${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}-${randomUUID().slice(0, 8)}`;

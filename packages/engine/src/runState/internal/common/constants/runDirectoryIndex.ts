import { RunDirectoryIndex } from '#src/runState/internal/common/services/RunDirectoryIndex.ts';

/**
 * The one index the process shares.
 *
 * A single shared instance is what makes "searched once per process" true; a
 * second instance would scan again and answer the same.
 */
export const runDirectoryIndex = new RunDirectoryIndex();

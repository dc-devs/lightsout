import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';

/**
 * What one round's measurement earned: a batch to hand a writer, or why no
 * batch could be built at all — which is always a human's question, never a
 * writer's.
 */
export type CoverageRound = { batch: CoverageBatch } | { error: string };

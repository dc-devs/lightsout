import type { StandardsFinding } from '#src/contracts/standardsCheck/StandardsFinding.ts';
import type { BatchStop } from '#src/refactor/internal/common/types/BatchStop.ts';

/**
 * What one batch pass answers with: either a terminal stop, or the sites that
 * survived a pass which DID change the tree — the work a requeue would carry.
 *
 * Named rather than spelled inline because the pass builds it in one place and
 * the caller reads it in another; two spellings of one union is how the two
 * drift apart.
 */
export type PassOutcome = { stop: BatchStop } | { workFindings: StandardsFinding[] };

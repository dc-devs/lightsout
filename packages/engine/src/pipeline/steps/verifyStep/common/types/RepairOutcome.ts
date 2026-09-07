import type { StepRecord } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';

/**
 * What a repair stage answers: the run's own stopped result when it parked, or
 * the record and gate verdict the next stage carries on with.
 *
 * `parked` is the discriminant every caller narrows on, so a park short-circuits
 * the checkpoint at whichever stage produced it.
 */
export type RepairOutcome = { parked: PipelineResult } | { record: StepRecord; result: VerificationResult };

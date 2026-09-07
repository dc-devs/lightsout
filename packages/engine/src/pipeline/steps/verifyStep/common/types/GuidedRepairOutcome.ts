import type { StepRecord, SupervisorVerdict } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';

/**
 * What the guided repair stage answers — `RepairOutcome` plus the ruling the
 * supervisor gave, which the checkpoint reports in its escalation message.
 *
 * Its own type rather than an optional field on `RepairOutcome`: no other stage
 * consults the supervisor, so no other stage can ever carry a ruling.
 */
export type GuidedRepairOutcome = { parked: PipelineResult } | { record: StepRecord; result: VerificationResult; ruling: SupervisorVerdict | undefined };

import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

/**
 * One writer's outcome, tagged with the assignment it covered.
 *
 * @typeParam TGroup - what one writer was given: a coverage group by default, a ledger test file's rows in the ledger step.
 */
export type WriterResult<TGroup = TestTargetGroup> = Awaited<ReturnType<PipelineRun['invokeRole']>> & { group: TGroup };

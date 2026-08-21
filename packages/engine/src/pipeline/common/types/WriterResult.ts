import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

/** One unit-test writer's outcome, tagged with the group it covered. */
export type WriterResult = Awaited<ReturnType<PipelineRun['invokeRole']>> & { group: TestTargetGroup };

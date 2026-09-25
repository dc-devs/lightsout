import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';

interface Params {
	status: PlanRunStatus;
}

/**
 * How a plan command's own resting state reads as the status an activity level
 * closes with.
 *
 * The two vocabularies answer different questions — one says what a plan
 * command produced, the other says how a recorded level settled — so a level
 * closed by a plan runner needs the translation stated once. A parked status
 * stays parked rather than becoming a failure: the wall is resumable, and the
 * report has to be able to say so.
 */
export const getPlanRunStatus = ({ status }: Params): RunStatus =>
	status === PlanRunStatus.Complete ? RunStatus.Passed : status === PlanRunStatus.PausedRateLimit ? RunStatus.PausedRateLimit : RunStatus.Failed;

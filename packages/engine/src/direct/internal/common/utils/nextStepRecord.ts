import type { RunState } from '#src/common/services/RunState.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';

interface Params {
	run: RunState;
	id: string;
}

/** The next attempt of a step, its attempt count carried forward from whatever the manifest already holds. */
export const nextStepRecord = ({ run, id }: Params): StepRecord => ({
	id,
	status: RunStatus.Running,
	attempts: (run.current().steps.find((step) => step.id === id)?.attempts ?? 0) + 1,
});

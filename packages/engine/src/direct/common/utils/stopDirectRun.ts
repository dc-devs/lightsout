import type { RunState } from '#src/common/services/RunState.ts';
import type { RunStatus, StepRecord } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';

interface Params {
	run: RunState;
	record: StepRecord;
	status: RunStatus;
	error: string;
}

/** Persist a terminal status and hand back the result the run reports. */
export const stopDirectRun = async ({ run, record, status, error }: Params): Promise<PipelineResult> => {
	await run.stop({ record, status, error, label: 'direct run' });

	return { ok: false, manifest: run.current(), error };
};

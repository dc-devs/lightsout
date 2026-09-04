import { RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	/** The verification step the crash happened in. */
	stepId: string;
	record: StepRecord;
	/** One line per gate that never returned a verdict — `runGates`' `crashes`. */
	crashes: string[];
	/** The gate output behind those crashes, kept as the evidence a human reads. */
	error: string | undefined;
}

/**
 * End a verification step on a gate that crashed instead of failing.
 *
 * A jest worker killed by SIGSEGV is not a verdict about the code, so there is
 * nothing here to repair: no fix attempt is spent, no fix agent is handed a
 * suite that passes, and no supervisor is bought to judge a toolchain fault.
 *
 * It stops rather than passes because a gate that never ran is not a green
 * gate — the run's whole claim is that its gates decided. What changes is what
 * the operator is told: the crash is named, so the answer reads as "run it
 * again" instead of "your tests are broken".
 */
export const stopOnGateCrash = ({ run, stepId, record, crashes, error }: Params): Promise<PipelineResult> => {
	run.progress(`step ${stepId}: gate crashed rather than failed — no fix attempted`);

	return run.stop({
		record,
		status: RunStatus.Escalated,
		error: [
			`${stepId}: a gate crashed instead of failing — the known jest worker SIGSEGV, not a verdict about the code.`,
			'No fix was attempted and no fix attempt was spent; re-running the run is the answer.',
			crashes.join('\n'),
			error ?? '',
		].join('\n\n'),
	});
};

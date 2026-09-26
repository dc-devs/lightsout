import { describeGateNoVerdictStop } from '#src/common/utils/describeGateNoVerdictStop.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { PipelineRun } from '#src/pipeline/internal/PipelineRun.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';

interface Params {
	run: PipelineRun;
	/** The verification step the crash or timeout happened in. */
	stepId: string;
	record: StepRecord;
	/** One line per gate that crashed on every attempt — `runGates`' `crashes`. */
	crashes: string[];
	/** One line per gate that ran past its ceiling on every attempt — `runGates`' `timeouts`. */
	timeouts: string[];
	/** The gate output behind those lines, kept as the evidence a human reads. */
	error: string | undefined;
}

/**
 * Stops a verification step whose gate crashed or timed out: no fix is spent,
 * and the step is not passed, because the gate never returned a verdict.
 */
export const stopOnGateNoVerdict = ({ run, stepId, record, crashes, timeouts, error }: Params): Promise<PipelineResult> => {
	const { ending, reason } = describeGateNoVerdictStop({ stepId, crashes, timeouts });

	run.progress(`step ${stepId}: gate ${ending} rather than failed — no fix attempted`);

	return run.stop({ record, status: RunStatus.Escalated, error: [reason, error ?? ''].join('\n\n') });
};

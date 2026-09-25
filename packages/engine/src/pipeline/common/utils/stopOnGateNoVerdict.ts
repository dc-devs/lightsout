import { describeGateNoVerdictStop } from '#src/common/utils/describeGateNoVerdictStop.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

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
 * End a verification step on a gate that crashed, or ran past its own time
 * ceiling, instead of failing.
 *
 * A jest worker killed by SIGSEGV, or a gate stopped by `timeouts.gate-minutes`,
 * is not a verdict about the code, so there is nothing here to repair: no fix
 * attempt is spent, no fix agent is handed a red nobody established, and no
 * supervisor is bought to judge a toolchain fault.
 *
 * It stops rather than passes because a gate that never finished is not a green
 * gate — the run's whole claim is that its gates decided. What changes is what
 * the operator is told: the crash or the ceiling is named, so the answer reads
 * as "run it again" instead of "your tests are broken".
 */
export const stopOnGateNoVerdict = ({ run, stepId, record, crashes, timeouts, error }: Params): Promise<PipelineResult> => {
	const { ending, reason } = describeGateNoVerdictStop({ stepId, crashes, timeouts });

	run.progress(`step ${stepId}: gate ${ending} rather than failed — no fix attempted`);

	return run.stop({ record, status: RunStatus.Escalated, error: [reason, error ?? ''].join('\n\n') });
};

import type { RunState } from '#src/common/services/RunState.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import { nextStepRecord } from '#src/direct/common/utils/nextStepRecord.ts';
import { runGates } from '#src/gates/runGates.ts';

/** The step every gate run of a direct run is recorded under. */
const verifyStep = 'verify';

interface Params {
	run: RunState;
}

/**
 * The repo's own gates over the whole tree, recorded as an attempt of the verify step.
 *
 * `crashes`, `timeouts` and `coordination` are passed on rather than folded
 * into `gateError` because the four ask different things of the caller: a red
 * gate is evidence to repair, a crashed one is a gate that never reached a
 * verdict, a timed-out one is a gate that ran past its ceiling and never reached
 * a verdict either, and a coordination reason is a gate run that never started
 * at all because another run of this repository held the machine.
 */
export const verifyDirectWork = async ({
	run,
}: Params): Promise<{ record: StepRecord; gateError: string | undefined; crashes: string[]; timeouts: string[]; coordination: string | undefined }> => {
	const record = nextStepRecord({ run, id: verifyStep });

	await run.setStep({ record });

	const {
		error: gateError,
		crashes,
		timeouts,
		coordination,
	} = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage: true,
		runId: run.current().runId,
		step: verifyStep,
		onProgress: (message) => run.progress(message),
	});

	await run.setStep({ record: { ...record, status: gateError ? RunStatus.Failed : RunStatus.Passed, error: gateError } });

	return { record, gateError, crashes, timeouts, coordination };
};

import type { RunState } from '#src/common/services/RunState.ts';
import { RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { nextStepRecord } from '#src/direct/common/utils/nextStepRecord.ts';
import { runGates } from '#src/gates/index.ts';

/** The step every gate run of a direct run is recorded under. */
const verifyStep = 'verify';

interface Params {
	run: RunState;
}

/**
 * The repo's own gates over the whole tree, recorded as an attempt of the verify step.
 *
 * `crashes` is passed on rather than folded into `gateError` because the two
 * ask different things of the caller: a red gate is evidence to repair, and a
 * crashed one is a gate that never reached a verdict.
 */
export const verifyDirectWork = async ({ run }: Params): Promise<{ record: StepRecord; gateError: string | undefined; crashes: string[] }> => {
	const record = nextStepRecord({ run, id: verifyStep });

	await run.setStep({ record });

	const { error: gateError, crashes } = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage: true,
		runId: run.current().runId,
		step: verifyStep,
		onProgress: (message) => run.progress(message),
	});

	await run.setStep({ record: { ...record, status: gateError ? RunStatus.Failed : RunStatus.Passed, error: gateError } });

	return { record, gateError, crashes };
};

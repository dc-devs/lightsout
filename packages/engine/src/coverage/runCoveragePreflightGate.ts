import { RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { CoverageResult } from '#src/coverage/CoverageResult.ts';
import type { CoverageRun } from '#src/coverage/CoverageRun.ts';
import { runGates } from '#src/gates/index.ts';

interface Params {
	run: CoverageRun;
}

/**
 * The pre-flight green gate, coverage excluded: the coverage gate is red by
 * definition here, but a red check or unit suite must not be blamed on a
 * batch. Skipped when an earlier attempt already passed it.
 *
 * @returns the run-ending result when the baseline is red, undefined to proceed
 */
export const runCoveragePreflightGate = async ({ run }: Params): Promise<CoverageResult | undefined> => {
	const steps = run.current().steps;

	if (steps.some((step) => step.id === 'pre-flight' && step.status === RunStatus.Passed)) {
		return undefined;
	}

	const record: StepRecord = {
		id: 'pre-flight',
		status: RunStatus.Running,
		attempts: (steps.find((step) => step.id === 'pre-flight')?.attempts ?? 0) + 1,
	};

	await run.setStep({ record });
	run.progress('pre-flight — types and unit tests before any batch');

	const gateError = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage: false,
		runId: run.current().runId,
		step: 'pre-flight',
		onProgress: (message) => run.progress(message),
	});

	let result: CoverageResult | undefined;

	if (gateError) {
		result = await run.stop({ record, status: RunStatus.Failed, error: `Codebase is not green before raising coverage — fix this first.\n${gateError}` });
	} else {
		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
	}

	return result;
};

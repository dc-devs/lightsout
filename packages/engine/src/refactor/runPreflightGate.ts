import { RunStatus, type StepRecord } from '@/contracts';
import { runGates } from '@/pipeline';
import type { RefactorResult } from '@/refactor/RefactorResult';
import type { RefactorRun } from '@/refactor/RefactorRun';

interface Params {
	run: RefactorRun;
}

/**
 * The pre-flight green gate: full gates before any agent spend, skipped when
 * an earlier attempt already passed it. A red gate after a batch can only
 * mean "the batch's doing" if the baseline was green.
 *
 * @returns the run-ending result when the baseline is red, undefined to proceed
 */
export const runPreflightGate = async ({ run }: Params): Promise<RefactorResult | undefined> => {
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
	run.progress('pre-flight — full gates before any batch');

	const gateError = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage: true,
		runId: run.current().runId,
		step: 'pre-flight',
		onProgress: (message) => run.progress(message),
	});

	let result: RefactorResult | undefined;

	if (gateError) {
		result = await run.stop({ record, status: RunStatus.Failed, error: `Codebase is not green before refactoring — fix this first.\n${gateError}` });
	} else {
		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
	}

	return result;
};

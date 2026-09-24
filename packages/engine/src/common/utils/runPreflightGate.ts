import { describeGateNoVerdict } from '#src/common/utils/describeGateNoVerdict.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';

/**
 * The slice of a run this gate touches, structural on purpose: a coverage run
 * and a refactor run share no declared type, and the gate needs nothing of
 * either beyond what `stop` hands back.
 */
interface GatedRun<TResult> {
	cwd: string;
	config: LightsoutConfig;
	current(): RunManifest;
	progress(message: string): void;
	setStep(params: { record: StepRecord; patch?: Partial<RunManifest> }): Promise<void>;
	stop(params: { record: StepRecord; status: RunStatus; error: string }): Promise<TResult>;
}

interface Params<TResult> {
	run: GatedRun<TResult>;
	/** Also run the coverage gate — off for a run whose coverage gate is red by definition. */
	coverage: boolean;
	/** The progress line announcing the gate, naming what this run's gates cover. */
	label: string;
	/** Sentence put in front of the gate output when the baseline is red. */
	redBaselineError: string;
}

/**
 * The pre-flight green gate: the consumer's own gates before any agent spend,
 * skipped when an earlier attempt already passed it. A red gate after a batch
 * can only mean "the batch's doing" if the baseline was green.
 *
 * A baseline gate that returned no verdict — the gate run never got the
 * machine, a gate crashed, or a gate ran past its ceiling — ends the run
 * escalated with its own reason instead, and records no passed pre-flight step,
 * so a later attempt runs the baseline again rather than inheriting a proof
 * nothing established.
 *
 * @returns the run-ending result when the baseline is red or returned no verdict, undefined to proceed
 */
export const runPreflightGate = async <TResult>({ run, coverage, label, redBaselineError }: Params<TResult>): Promise<TResult | undefined> => {
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
	run.progress(label);

	const gates = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage,
		runId: run.current().runId,
		step: 'pre-flight',
		onProgress: (message) => run.progress(message),
	});

	const noVerdict = describeGateNoVerdict({ result: gates });
	let result: TResult | undefined;

	if (noVerdict !== undefined) {
		// No baseline gate returned a verdict, so the baseline was neither proved
		// nor disproved: the run ends for a human naming why, never with the
		// red-baseline sentence, which asserts something about the consumer's code
		// that no command here established.
		result = await run.stop({ record, status: RunStatus.Escalated, error: noVerdict });
	} else if (gates.error) {
		result = await run.stop({ record, status: RunStatus.Failed, error: `${redBaselineError}\n${gates.error}` });
	} else {
		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
	}

	return result;
};

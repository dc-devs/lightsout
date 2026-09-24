import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import { RunState } from '#src/common/services/RunState.ts';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { describeGateCoordinationStop } from '#src/common/utils/describeGateCoordinationStop.ts';
import { describeGateNoVerdictStop } from '#src/common/utils/describeGateNoVerdictStop.ts';
import { runPreflightGate } from '#src/common/utils/runPreflightGate.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { createDirectRun } from '#src/direct/common/utils/createDirectRun.ts';
import { finishDirectRun } from '#src/direct/common/utils/finishDirectRun.ts';
import { stopDirectRun } from '#src/direct/common/utils/stopDirectRun.ts';
import { invokeDirectWorker } from '#src/direct/invokeDirectWorker.ts';
import { verifyDirectWork } from '#src/direct/verifyDirectWork.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { withRunLock } from '#src/runState/index.ts';
import { resolveStandards } from '#src/standards/index.ts';

interface Params {
	/** The checkout to build in — a queue worktree, or the user's own tree when run standalone. */
	cwd: string;
	/** The ticket body, verbatim. */
	ticketBody: string;
	/** The ticket's human reference, for the run header. */
	ticketRef: string;
	/** The id a fresh run is created under, minted by the caller so the run can be named before it starts. Ignored when resuming. */
	runId?: string;
	driver: Driver;
	/** Recorded on the manifest as the harness name. */
	driverName: string;
	config: LightsoutConfig;
	/** The answer to a question a previous invocation asked — the queue's relay loop threads it back in. */
	answeredQuestion?: AnsweredQuestion;
	/** Resolved before the run starts: a passing run will ship this branch. Recorded on the manifest so the progress view can show a ship row. */
	willShip?: boolean;
	/** The run to continue instead of minting a new one — a resumed direct run keeps its id, its frozen ticket input and the partial changes already in its tree. */
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}

/**
 * End a direct run whose gates never started, because another gate run of this
 * repository held the machine for longer than the wait allows.
 *
 * Nothing here was judged, so no fix attempt is spent and no worker is
 * re-invoked; the tree the run built is left exactly where it is.
 */
const stopDirectOnCoordination = ({ run, record, coordination }: { run: RunState; record: StepRecord; coordination: string }) => {
	run.progress('the gates never started — another run holds this machine, and no fix was attempted');

	return stopDirectRun({
		run,
		record,
		status: RunStatus.Escalated,
		error: describeGateCoordinationStop({ stepId: 'verify', coordination }),
	});
};

/**
 * End a direct run on a gate that crashed, or ran past its own time ceiling,
 * instead of failing.
 *
 * Neither reached a verdict, so there is nothing to repair and nothing the next
 * attempt would do differently — it stops without spending an attempt, rather
 * than handing the worker a red no gate command established.
 */
const stopDirectOnNoVerdict = ({
	run,
	record,
	crashes,
	timeouts,
	gateError,
}: {
	run: RunState;
	record: StepRecord;
	crashes: string[];
	timeouts: string[];
	gateError: string | undefined;
}) => {
	const { ending, reason } = describeGateNoVerdictStop({ stepId: 'verify', crashes, timeouts });

	run.progress(`a gate ${ending} rather than failed — no fix attempted`);

	return stopDirectRun({ run, record, status: RunStatus.Escalated, error: [reason, gateError ?? ''].join('\n\n') });
};

/**
 * Build from the ticket body, gate the result, and hand a red gate back to the
 * worker until the cheap fix budget is spent — the whole of the direct run once
 * the pre-flight baseline has proved the tree green.
 *
 * There is no supervisor, no unit-test writer and no standards review: the
 * repo's gates are the only bar.
 */
const buildAndVerify = async ({
	run,
	driver,
	ticketRef,
	ticketBody,
	standards,
	answeredQuestion,
	resumed,
}: {
	run: RunState;
	driver: Driver;
	ticketRef: string;
	ticketBody: string;
	standards?: string;
	answeredQuestion?: AnsweredQuestion;
	resumed: boolean;
}) => {
	let errorContext: string | undefined;

	for (let attempt = 0; ; attempt += 1) {
		const stopped = await invokeDirectWorker({ run, driver, ticketRef, ticketBody, standards, answeredQuestion, errorContext });

		if (stopped) {
			return stopped;
		}

		const { record, gateError, crashes, timeouts, coordination } = await verifyDirectWork({ run });

		if (coordination !== undefined) {
			return stopDirectOnCoordination({ run, record, coordination });
		}

		if (crashes.length > 0 || timeouts.length > 0) {
			return stopDirectOnNoVerdict({ run, record, crashes, timeouts, gateError });
		}

		if (gateError === undefined) {
			return finishDirectRun({ run, driver, ticketRef, ticketBody, resumed });
		}

		errorContext = gateError;

		if (attempt === maxCheapFixRetries) {
			return stopDirectRun({ run, record, status: RunStatus.Failed, error: gateError });
		}

		run.progress(`the gates are red — re-invoking the worker with their output (fix ${attempt + 1} of ${maxCheapFixRetries})`);
	}
};

/**
 * The direct run's body — always entered holding the run lock.
 *
 * Pre-flight green gate → build from the ticket body → the repo's own gates,
 * with a bounded fix loop → done. The coverage gate is included from the
 * pre-flight onward, so a repo that requires tests still requires them.
 *
 * A continued run (`existing` set) adopts that run's manifest rather than
 * minting a second, and skips the pre-flight. That skip is the point rather
 * than an optimisation: the gate exists to prove the tree was green BEFORE any
 * agent touched it, and a resumed tree holds the run's own partial work, so
 * re-running it would fail the run on the very changes the resume exists to
 * preserve. Everything after it is shared by a first run and a resumed one.
 *
 * A run whose `verify` step is already recorded passed skips the worker and the
 * gates as well and goes straight to its commit. The step record decides that,
 * never the run's own status: a run stopped at a refused commit is failed with
 * its gates still green behind it, and rebuilding it would spend a model on
 * work that is already done.
 */
const executeDirectWork = async ({
	cwd,
	runId,
	ticketBody,
	ticketRef,
	driver,
	driverName,
	config,
	answeredQuestion,
	willShip,
	existing,
	onProgress,
}: Params & { runId: string }) => {
	const manifest = existing ?? (await createDirectRun({ cwd, runId, ticketBody, ticketRef, driverName, config, willShip }));
	const run = new RunState({ cwd, config, manifest, onProgress });
	const stop = ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }) => stopDirectRun({ run, record, status, error });

	await run.update({ patch: { status: RunStatus.Running } });

	if (run.current().steps.some((step) => step.id === 'verify' && step.status === RunStatus.Passed)) {
		return finishDirectRun({ run, driver, ticketRef, ticketBody, resumed: true });
	}

	const redBaseline =
		existing === undefined
			? await runPreflightGate({
					run: {
						cwd,
						config,
						current: () => run.current(),
						progress: (message: string) => run.progress(message),
						setStep: (params: { record: StepRecord; patch?: Partial<RunManifest> }) => run.setStep(params),
						stop,
					},
					coverage: true,
					label: 'pre-flight — the repo’s own gates before any agent',
					redBaselineError: `Codebase is not green before building ${ticketRef} — fix this first.`,
				})
			: undefined;

	if (redBaseline) {
		return redBaseline;
	}

	const { standards } = await resolveStandards({ cwd, config, packages: [] });

	return buildAndVerify({ run, driver, ticketRef, ticketBody, standards, answeredQuestion, resumed: existing !== undefined });
};

/**
 * Ticket body in, committed diff out — the queue's direct worker, and the whole
 * of what `lightsout implement-direct` does.
 *
 * Answers a `PipelineResult` rather than a new near-identical type, so every
 * existing reader of a run result already understands it. A re-invocation
 * (`answeredQuestion` set) runs in the same tree the previous attempt dirtied
 * and continues that work in place; each invocation mints its own run, so every
 * attempt keeps its own truthful record — except a resume (`existing` set),
 * which deliberately continues the parked run rather than minting a second.
 */
export const runDirectWork = (params: Params): Promise<PipelineResult> => withRunLock({ params, run: executeDirectWork });

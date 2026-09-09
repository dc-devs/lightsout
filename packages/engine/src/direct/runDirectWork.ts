import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { RunState } from '#src/common/services/RunState.ts';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { describeGateCoordinationStop } from '#src/common/utils/describeGateCoordinationStop.ts';
import { runPreflightGate } from '#src/common/utils/runPreflightGate.ts';
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { stopDirectRun } from '#src/direct/common/utils/stopDirectRun.ts';
import { invokeDirectWorker } from '#src/direct/invokeDirectWorker.ts';
import { verifyDirectWork } from '#src/direct/verifyDirectWork.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { createRun, getRunDir, withRunLock } from '#src/runState/index.ts';
import { resolveStandards } from '#src/standards/index.ts';

interface Params {
	/** The checkout to build in — a queue worktree, or the user's own tree when run standalone. */
	cwd: string;
	/** The ticket body, verbatim. */
	ticketBody: string;
	/** The ticket's human reference, for the run header. */
	ticketRef: string;
	driver: Driver;
	/** Recorded on the manifest as the harness name. */
	driverName: string;
	config: LightsoutConfig;
	/** The answer to a question a previous invocation asked — the queue's relay loop threads it back in. */
	answeredQuestion?: AnsweredQuestion;
	/** Resolved before the run starts: a passing run will ship this branch. Recorded on the manifest so the progress view can show a ship row. */
	willShip?: boolean;
	onProgress?: (message: string) => void;
}

/** The run this ticket is built in, with the ticket body written beside it as the document the run was built from. */
const createDirectRun = async ({
	cwd,
	runId,
	ticketBody,
	ticketRef,
	driverName,
	config,
	willShip,
}: {
	cwd: string;
	runId: string;
	ticketBody: string;
	ticketRef: string;
	driverName: string;
	config: LightsoutConfig;
	willShip?: boolean;
}) => {
	const ticketPath = join(getRunDir({ cwd, runId }), 'ticket.md');
	const manifest = await createRun({
		cwd,
		runId,
		plan: ticketPath,
		pipeline: PipelineKind.Direct,
		ticketRef,
		driver: driverName,
		config,
		baselineDirtyFiles: await readGitChangedFiles({ cwd }),
		willShip,
	});

	// There is no plan file for direct work; the ticket body is the document the
	// run was built from, so it is what the manifest records.
	await writeFile(ticketPath, ticketBody.endsWith('\n') ? ticketBody : `${ticketBody}\n`, 'utf8');

	return manifest;
};

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
 * End a direct run on a gate that crashed instead of failing.
 *
 * A crashed gate reached no verdict, so there is nothing to repair and nothing
 * the next attempt would do differently — it stops without spending an attempt,
 * rather than handing the worker a suite that is not broken.
 */
const stopDirectOnCrash = ({ run, record, crashes, gateError }: { run: RunState; record: StepRecord; crashes: string[]; gateError: string | undefined }) => {
	run.progress('a gate crashed rather than failed — no fix attempted');

	return stopDirectRun({
		run,
		record,
		status: RunStatus.Escalated,
		error: [
			'verify: a gate crashed instead of failing — the known jest worker SIGSEGV, not a verdict about the code.',
			'No fix was attempted and no fix attempt was spent; re-running the run is the answer.',
			crashes.join('\n'),
			gateError ?? '',
		].join('\n\n'),
	});
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
}: {
	run: RunState;
	driver: Driver;
	ticketRef: string;
	ticketBody: string;
	standards?: string;
	answeredQuestion?: AnsweredQuestion;
}) => {
	let errorContext: string | undefined;

	for (let attempt = 0; ; attempt += 1) {
		const stopped = await invokeDirectWorker({ run, driver, ticketRef, ticketBody, standards, answeredQuestion, errorContext });

		if (stopped) {
			return stopped;
		}

		const { record, gateError, crashes, coordination } = await verifyDirectWork({ run });

		if (coordination !== undefined) {
			return stopDirectOnCoordination({ run, record, coordination });
		}

		if (crashes.length > 0) {
			return stopDirectOnCrash({ run, record, crashes, gateError });
		}

		if (gateError === undefined) {
			await run.update({ patch: { status: RunStatus.Passed, currentStep: null } });

			const passed: PipelineResult = { ok: true, manifest: run.current() };

			return passed;
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
	onProgress,
}: Params & { runId: string }) => {
	const manifest = await createDirectRun({ cwd, runId, ticketBody, ticketRef, driverName, config, willShip });
	const run = new RunState({ cwd, config, manifest, onProgress });
	const stop = ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }) => stopDirectRun({ run, record, status, error });

	await run.update({ patch: { status: RunStatus.Running } });

	const redBaseline = await runPreflightGate({
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
	});

	if (redBaseline) {
		return redBaseline;
	}

	const { standards } = await resolveStandards({ cwd, config, packages: [] });

	return buildAndVerify({ run, driver, ticketRef, ticketBody, standards, answeredQuestion });
};

/**
 * Ticket body in, verified diff out — the queue's direct worker, and the whole
 * of what `lightsout implement-direct` does before it commits.
 *
 * Answers a `PipelineResult` rather than a new near-identical type, so every
 * existing reader of a run result already understands it. A re-invocation
 * (`answeredQuestion` set) runs in the same tree the previous attempt dirtied
 * and continues that work in place; each invocation mints its own run, so every
 * attempt keeps its own truthful record.
 */
export const runDirectWork = (params: Params): Promise<PipelineResult> => withRunLock({ params, run: executeDirectWork });

import { resolveGateOverride } from '#src/common/config/resolveGateOverride.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import type { AcceptanceRow } from '#src/common/types/AcceptanceRow.ts';
import { packageOf } from '#src/common/workspace/packageOf.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { checkChangedFilesExecuted } from '#src/coverage/index.ts';
import { checkAcceptanceTests, collectGateObservations, resolveGateSchedule, runGates } from '#src/gates/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

/** A coverage gate that actually ran and came back green — what the per-file executed check needs a report from. */
const passedCoverage = ({ gate }: { gate: GateResult }) => gate.kind === 'testCoverage' && gate.skipped !== true && gate.exitCode === 0;

/**
 * The per-file accountability check over the report the coverage gate just
 * wrote: every changed file (minus the recorded unreachable ones) must show at
 * least one executed statement.
 */
const changedFilesExecutedError = ({ run, packagesDir }: { run: PipelineRun; packagesDir: string }) => {
	const manifest = run.current();

	return checkChangedFilesExecuted({
		cwd: run.cwd,
		config: run.config,
		compiler: resolveConsumerTypescript({ cwd: run.cwd, packagesDir }),
		changedFiles: sourceFiles({ run }).filter((file) => !manifest.unreachableChangedFiles.includes(file)),
	});
};

interface Params {
	run: PipelineRun;
	/**
	 * Also run the coverage gate. On at clean-slate and every verify AFTER
	 * tests exist; off for verify-implement, where freshly written source has
	 * no tests yet and a coverage failure would not be the agent's fault.
	 */
	coverage?: boolean;
	/**
	 * The verification checkpoint in flight — 'clean-slate', 'verify-implement',
	 * 'verify-tests' or 'verify-refactor' — whose `gate-overrides` entry decides
	 * its gate schedule.
	 */
	checkpoint: string;
	/**
	 * The acceptance tests this checkpoint must prove, in the shape
	 * `checkAcceptanceTests` takes. Empty where the plan carries no ledger, and at
	 * clean-slate, where the ledger's tests have not been written yet.
	 */
	rows: AcceptanceRow[];
	/** True only at the run's last verification, where an acceptance test no gate proved is a failure rather than a skip. */
	final?: boolean;
}

/**
 * The run's verification gates, bound to its live scope and evidence log.
 *
 * How the gates are scheduled is the checkpoint's own `gate-overrides` entry
 * where it has one — exactly those gates, in that order — and the engine's two
 * tiers where it does not: the cheap gates first, the expensive ones only once
 * every package group's cheap gates are green.
 *
 * After the gates, every acceptance test the checkpoint was given must be shown
 * to have executed and passed in the per-test results those gates wrote. It runs
 * before the per-file executed check because it judges the gates that just ran,
 * where that check judges the coverage report they produced — and a checkpoint
 * that cannot prove its acceptance tests has nothing to gain from also being
 * told which files went uncovered.
 *
 * When the coverage gate actually ran and passed, the per-file executed check
 * follows: every changed file (minus the recorded unreachable ones) must show at
 * least one executed statement in the summaries the gate just wrote — the one
 * check the repo-wide threshold cannot make. It follows the gate rather than the
 * `coverage` argument because an override may add the gate where the argument
 * says off, or drop it where the argument says on. At clean-slate the changed
 * set is empty, so the check is a no-op there.
 */
export const runVerificationGates = async ({ run, coverage, checkpoint, rows, final }: Params): Promise<VerificationResult> => {
	const packagesDir = run.config['packages-dir'] ?? defaultPackagesDir;
	const hasRootChanges = run.current().changedFiles.some((file) => packageOf({ file, packagesDir }) === undefined);
	const collector = collectGateObservations();

	const result = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage,
		packages: run.current().packages,
		includeRoot: hasRootChanges,
		failFast: false,
		schedule: resolveGateSchedule({ override: resolveGateOverride({ overrides: run.config['gate-overrides'], checkpoint }) }),
		runId: run.current().runId,
		step: run.current().currentStep ?? undefined,
		onGateResult: collector.onGateResult,
		onProgress: (message) => run.progress(message),
	});
	const gates = collector.observed();
	// A crashed gate is red without being evidence, so it is kept out of the
	// failure list the step shows and the fix agent reads — `crashes` is where
	// it is reported instead.
	const failures = gates.filter(
		(observation) =>
			observation.skipped !== true &&
			observation.crashed !== true &&
			observation.exitCode !== undefined &&
			observation.exitCode !== 0 &&
			result.failedFamilies.includes(observation.kind),
	);
	const coverageRan = gates.some((gate) => passedCoverage({ gate }));

	// The gates' own verdict unless a post-gate check overrules it. Held in one
	// place so `gates` — every observation, which both the acceptance check and
	// the clean-slate probe read back — is attached once at the end rather than
	// re-listed by each branch, where one branch eventually forgets it.
	let verdict: Omit<VerificationResult, 'gates'> = { ...result, failures };

	if (result.error === undefined) {
		const acceptanceError = await checkAcceptanceTests({
			cwd: run.cwd,
			rows,
			gates,
			final: final === true,
			packagesDir,
			onProgress: (message) => run.progress(message),
		});

		if (acceptanceError !== undefined) {
			verdict = { error: acceptanceError, failedFamilies: ['acceptance-tests'], crashes: [], failures: [] };
		} else if (coverageRan) {
			const executedError = await changedFilesExecutedError({ run, packagesDir });

			verdict =
				executedError === undefined
					? { error: undefined, failedFamilies: [], crashes: [], failures: [] }
					: { error: executedError, failedFamilies: ['changed-files-executed'], crashes: [], failures: [] };
		}
	}

	return { ...verdict, gates };
};

import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { packageOf } from '#src/common/workspace/packageOf.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { checkChangedFilesExecuted } from '#src/coverage/index.ts';
import { type GateRunResult, runGates } from '#src/gates/index.ts';
import { restoreLedgerTests } from '#src/pipeline/common/utils/restoreLedgerTests.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	/**
	 * Also run the coverage gate. On at clean-slate and every verify AFTER
	 * tests exist; off for verify-implement, where freshly written source has
	 * no tests yet and a coverage failure would not be the agent's fault.
	 */
	coverage?: boolean;
}

/**
 * The run's verification gates, bound to its live scope and evidence log.
 *
 * The ledger lock runs first, BEFORE the gates: an edited acceptance test can
 * make a gate pass, so the copy has to be back in place or the gate proves the
 * wrong thing. A restored file is announced and nothing more — the gates then
 * decide, and the step's own fix role repairs a red test the way it does today.
 *
 * When the coverage gate ran clean, the per-file executed check follows: every
 * changed file (minus the recorded unreachable ones) must show at least one
 * executed statement in the summaries the gate just wrote — the one check the
 * repo-wide threshold cannot make. At clean-slate the changed set is empty,
 * so the check is a no-op there.
 */
export const runVerificationGates = async ({ run, coverage }: Params): Promise<GateRunResult & { failures: GateResult[] }> => {
	const packagesDir = run.config['packages-dir'] ?? defaultPackagesDir;
	const hasRootChanges = run.current().changedFiles.some((file) => packageOf({ file, packagesDir }) === undefined);
	const observations = new Map<string, GateResult>();

	if (run.current().ledgerTests.length > 0) {
		const { restored } = await restoreLedgerTests({ run });

		for (const path of restored) {
			run.progress(`ledger lock: ${path} was edited during the run — the locked copy was put back before the gates ran`);
		}
	}

	const result = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage,
		packages: run.current().packages,
		includeRoot: hasRootChanges,
		failFast: false,
		runId: run.current().runId,
		step: run.current().currentStep ?? undefined,
		onGateResult: (gateResult) => observations.set(`${gateResult.group}\0${gateResult.kind}`, gateResult),
		onProgress: (message) => run.progress(message),
	});
	// A crashed gate is red without being evidence, so it is kept out of the
	// failure list the step shows and the fix agent reads — `crashes` is where
	// it is reported instead.
	const failures = [...observations.values()].filter(
		(observation) =>
			observation.skipped !== true &&
			observation.crashed !== true &&
			observation.exitCode !== undefined &&
			observation.exitCode !== 0 &&
			result.failedFamilies.includes(observation.kind),
	);

	if (result.error !== undefined || !coverage) {
		return { ...result, failures };
	}

	const manifest = run.current();
	const compiler = resolveConsumerTypescript({ cwd: run.cwd, packagesDir });

	const error = await checkChangedFilesExecuted({
		cwd: run.cwd,
		config: run.config,
		compiler,
		changedFiles: sourceFiles({ run }).filter((file) => !manifest.unreachableChangedFiles.includes(file)),
	});

	return error === undefined
		? { error: undefined, failedFamilies: [], crashes: [], failures: [] }
		: { error, failedFamilies: ['changed-files-executed'], crashes: [], failures: [] };
};

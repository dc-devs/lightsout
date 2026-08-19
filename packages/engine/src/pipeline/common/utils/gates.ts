import { defaultPackagesDir } from '@/common/constants/defaultPackagesDir';
import { packageOf } from '@/common/utils/packageOf';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { checkChangedFilesExecuted } from '@/coverage';
import { sourceFiles } from '@/pipeline/common/utils/sourceFiles';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import { runGates } from '@/pipeline/runGates';

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
 * When the coverage gate ran clean, the per-file executed check follows: every
 * changed file (minus the recorded unreachable ones) must show at least one
 * executed statement in the summaries the gate just wrote — the one check the
 * repo-wide threshold cannot make. At clean-slate the changed set is empty,
 * so the check is a no-op there.
 */
export const gates = async ({ run, coverage }: Params): Promise<string | undefined> => {
	const packagesDir = run.config['packages-dir'] ?? defaultPackagesDir;
	const hasRootChanges = run.current().changedFiles.some((file) => packageOf({ file, packagesDir }) === undefined);

	const error = await runGates({
		cwd: run.cwd,
		config: run.config,
		coverage,
		packages: run.current().packages,
		includeRoot: hasRootChanges,
		runId: run.current().runId,
		step: run.current().currentStep ?? undefined,
		onProgress: (message) => run.progress(message),
	});

	if (error !== undefined || !coverage) {
		return error;
	}

	const manifest = run.current();
	const compiler = resolveConsumerTypescript({ cwd: run.cwd, packagesDir });

	return checkChangedFilesExecuted({
		cwd: run.cwd,
		config: run.config,
		compiler,
		changedFiles: sourceFiles({ run }).filter((file) => !manifest.unreachableChangedFiles.includes(file)),
	});
};

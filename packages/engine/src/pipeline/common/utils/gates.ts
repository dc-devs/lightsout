import { packageOf } from '../../../common/utils/packageOf';
import type { PipelineRun } from '../../PipelineRun';
import { runGates } from '../../runGates';

interface Params {
	run: PipelineRun;
	/**
	 * Also run the coverage gate. On at clean-slate and every verify AFTER
	 * tests exist; off for verify-implement, where freshly written source has
	 * no tests yet and a coverage failure would not be the agent's fault.
	 */
	coverage?: boolean;
}

/** The run's verification gates, bound to its live scope and evidence log. */
export const gates = ({ run, coverage }: Params): Promise<string | undefined> => {
	const packagesDir = run.config.packagesDir ?? 'packages';
	const hasRootChanges = run.current().changedFiles.some((file) => packageOf({ file, packagesDir }) === undefined);

	return runGates({
		cwd: run.cwd,
		config: run.config,
		coverage,
		packages: run.current().packages,
		includeRoot: hasRootChanges,
		runId: run.current().runId,
		step: run.current().currentStep ?? undefined,
		onProgress: (message) => run.progress(message),
	});
};

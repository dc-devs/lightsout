import { defaultPackagesDir } from '@/common/constants/defaultPackagesDir';
import { readGitChangedFiles } from '@/common/git/readGitChangedFiles';
import { packageOf } from '@/common/utils/packageOf';
import type { LightsoutConfig } from '@/contracts';
import { runGates } from '@/pipeline/runGates';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Also run the coverage gate. Refactor passes true (a refactor must not drop coverage); the coverage pipeline passes false (its gate is red by definition mid-run). */
	coverage: boolean;
	runId: string;
	/** The batch step id, recorded into the command log. */
	step: string;
	onProgress: (message: string) => void;
}

/**
 * A batch's verification gates, scoped to what the tree actually changed:
 * package scope inferred from the current git diff, root included when root
 * files changed.
 */
export const runBatchGates = async ({ cwd, config, coverage, runId, step, onProgress }: Params): Promise<string | undefined> => {
	const changed = (await readGitChangedFiles({ cwd })) ?? [];
	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const touched = [
		...new Set(
			changed.flatMap((file) => {
				const name = packageOf({ file, packagesDir });

				return name === undefined ? [] : [name];
			}),
		),
	];

	return runGates({
		cwd,
		config,
		coverage,
		packages: touched,
		includeRoot: changed.some((file) => packageOf({ file, packagesDir }) === undefined),
		runId,
		step,
		onProgress,
	});
};

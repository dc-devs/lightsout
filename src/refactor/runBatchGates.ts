import type { LightsoutConfig } from '@/contracts';
import { packageOf } from '@/common/utils/packageOf';
import { readGitChangedFiles } from '@/common/git/readGitChangedFiles';
import { runGates } from '@/pipeline';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	runId: string;
	/** The batch step id, recorded into the command log. */
	step: string;
	onProgress: (message: string) => void;
}

/**
 * A batch's verification gates, scoped to what the tree actually changed:
 * package scope inferred from the current git diff, root included when root
 * files changed, coverage always on — a refactor must not drop coverage.
 */
export const runBatchGates = async ({ cwd, config, runId, step, onProgress }: Params): Promise<string | undefined> => {
	const changed = (await readGitChangedFiles({ cwd })) ?? [];
	const packagesDir = config.packagesDir ?? 'packages';
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
		coverage: true,
		packages: touched,
		includeRoot: changed.some((file) => packageOf({ file, packagesDir }) === undefined),
		runId,
		step,
		onProgress,
	});
};

import { renderRunProgress } from '#src/cli/common/render/renderRunProgress.ts';
import { readRunManifest, readRunProcessLock } from '#src/runState/index.ts';
import { getRunProgress, type RunProgress } from '#src/views/index.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * A run's progress block as lines, with the view behind them. It prints
 * nothing, so a caller can place the block wherever it belongs — after a blank
 * line at the terminal, or inside a fence.
 *
 * @throws {RunNotFoundError} When no run on disk answers to the given id.
 */
export const loadRunProgressBlock = async ({ cwd, runId }: Params): Promise<{ progress: RunProgress; lines: string[] }> => {
	const manifest = await readRunManifest({ cwd, runId });
	const lock = await readRunProcessLock({ cwd, manifest });
	const progress = await getRunProgress({ cwd, manifest, lock });

	return { progress, lines: renderRunProgress({ progress }) };
};

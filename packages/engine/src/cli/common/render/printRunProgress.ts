import { renderRunProgress } from '#src/cli/common/render/renderRunProgress.ts';
import { readRunLock, readRunManifest } from '#src/runState/index.ts';
import { getRunProgress, type RunProgress } from '#src/views/index.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Print one frame of a run's progress block and answer with the view behind it,
 * so a watch can decide from the same read whether to paint again.
 *
 * A frame is APPENDED — a leading blank line, then the block. Nothing clears
 * the screen, because the implement skill relays this stdout into a chat
 * transcript, where a clear-screen sequence is noise and the previous frames
 * are the history a reader scrolls back through.
 *
 * @throws {RunNotFoundError} When no run on disk answers to the given id.
 */
export const printRunProgress = async ({ cwd, runId }: Params): Promise<RunProgress> => {
	const manifest = await readRunManifest({ cwd, runId });
	const lock = await readRunLock({ cwd });
	const progress = await getRunProgress({ cwd, manifest, lock });

	console.log('');

	for (const line of renderRunProgress({ progress })) {
		console.log(line);
	}

	return progress;
};

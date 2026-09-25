import { printRunProgress } from '#src/cli/common/render/printRunProgress.ts';
import { listRuns } from '#src/views/listRuns.ts';

interface Params {
	cwd: string;
}

/**
 * The newest run of any status, painted once, for a repo where nothing is
 * going: a terminal user still sees the last run instead of a minute of silence
 * and a false claim that there are none.
 *
 * It paints ONE block, never a family pair, even when the newest run is a
 * phased coordinator. The bare `--watch` path falls back here too, and what
 * `--watch` shows is settled.
 */
export const printNewestRun = async ({ cwd }: Params): Promise<void> => {
	const newest = (await listRuns({ cwd }))[0]?.runId;

	if (newest === undefined) {
		console.log('no runs found');
		return;
	}

	await printRunProgress({ cwd, runId: newest });
};

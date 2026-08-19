import { unlink } from 'node:fs/promises';
import { getRunLockPath } from '@/runState/common/paths/getRunLockPath';
import { readRunLock } from '@/runState/readRunLock';

interface Params {
	cwd: string;
	runId: string;
}

/** Drop the run lock — but only our own. A lock held by another pid or run is never deleted here. */
export const releaseRunLock = async ({ cwd, runId }: Params): Promise<void> => {
	const holder = await readRunLock({ cwd });

	if (!holder || holder.pid !== process.pid || holder.runId !== runId) {
		return;
	}

	await unlink(getRunLockPath({ cwd })).catch(() => undefined);
};

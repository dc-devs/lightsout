import { open } from 'node:fs/promises';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';

interface Params {
	path: string;
}

/** Flush the directory entry after publication when the host supports directory fsync. */
export const flushPlanningDirectory = async ({ path }: Params): Promise<void> => {
	const handle = await open(path, 'r');
	try {
		await handle.sync();
	} catch (error) {
		if (!(planningErrorCode({ error }) === 'EINVAL' || planningErrorCode({ error }) === 'ENOTSUP')) throw error;
	} finally {
		await handle.close();
	}
};

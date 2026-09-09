import { unlink } from 'node:fs/promises';
import { readGateLock } from '#src/gates/gateLock/readGateLock.ts';

interface Params {
	lockPath: string;
	runId: string;
}

/**
 * Hand the machine back — but only our own reservation. A document another run
 * has since reclaimed is left exactly where it is, so a reclaim is never undone
 * by the run it replaced.
 */
export const releaseGateLock = async ({ lockPath, runId }: Params): Promise<void> => {
	const holder = readGateLock({ lockPath });

	if (!holder || holder.pid !== process.pid || holder.runId !== runId) {
		return;
	}

	await unlink(lockPath).catch(() => undefined);
};

import { randomUUID } from 'node:crypto';
import { acquireRunLock } from '@/runState/acquireRunLock';
import { releaseRunLock } from '@/runState/releaseRunLock';

/** The slice of pipeline params the lock lifecycle itself needs. */
interface PipelineParams {
	cwd: string;
	/** Resume: reuse this run's id instead of minting one. */
	existing?: { runId: string };
	onProgress?: (message: string) => void;
}

interface Params<Input extends PipelineParams, Result> {
	params: Input;
	/** The pipeline body, entered holding the lock with the run id threaded in. */
	run: (params: Input & { runId: string }) => Promise<Result>;
}

/**
 * The run-lock lifecycle both pipelines share: mint (or reuse) the run id,
 * acquire the repo-wide lock under it BEFORE any disk write — a conflicting
 * start throws RunLockError and nothing else happened — narrate a stolen
 * stale lock, then always release, on every exit path including parks and
 * escalations. The lock guards the process, not the run; resume re-acquires.
 */
export const withRunLock = async <Input extends PipelineParams, Result>({ params, run }: Params<Input, Result>): Promise<Result> => {
	const runId = params.existing?.runId ?? randomUUID();
	const lock = await acquireRunLock({ cwd: params.cwd, runId });

	if (lock.stalePid !== undefined) {
		params.onProgress?.(`stale run lock from dead pid ${lock.stalePid} — taking over`);
	}

	try {
		return await run({ ...params, runId });
	} finally {
		await releaseRunLock({ cwd: params.cwd, runId });
	}
};

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getRunLockPath } from '@/runState/getRunLockPath';
import { isPidAlive } from '@/runState/isPidAlive';
import { readRunLock } from '@/runState/readRunLock';
import { RunLockError } from '@/runState/RunLockError';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Take the repo-wide run lock with an exclusive create (`wx`), so two
 * simultaneous starts can never both win. A holder whose pid is alive is a
 * live conflict → RunLockError, fail fast. A holder whose pid is dead (or a
 * lock that won't parse) is a crash leftover → stolen, with the dead pid
 * reported back so the caller can announce the takeover.
 */
export const acquireRunLock = async ({ cwd, runId }: Params) => {
	const lockPath = getRunLockPath({ cwd });
	const payload = `${JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() }, null, '\t')}\n`;

	await mkdir(dirname(lockPath), { recursive: true });

	let stalePid: number | undefined;

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await writeFile(lockPath, payload, { flag: 'wx' });

			return { stalePid };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw error;
			}
		}

		const holder = await readRunLock({ cwd });

		if (holder && isPidAlive({ pid: holder.pid })) {
			throw new RunLockError(
				`another lightsout run is active in this repo: run ${holder.runId} (pid ${holder.pid}, started ${holder.startedAt}). Wait for it to finish — or delete .lightsout/lock.json if you are certain nothing is running.`,
			);
		}

		stalePid = holder?.pid;
		await unlink(lockPath).catch(() => undefined);
	}

	throw new RunLockError('could not acquire .lightsout/lock.json — another process keeps taking the lock');
};

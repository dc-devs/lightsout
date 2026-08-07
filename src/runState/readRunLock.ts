import { readFile } from 'node:fs/promises';
import { RunLock } from '@/contracts';
import { getRunLockPath } from '@/runState/getRunLockPath';

interface Params {
	cwd: string;
}

/** The current run lock, or undefined when absent or unparseable (the acquirer treats a corrupt lock as stale). */
export const readRunLock = async ({ cwd }: Params) => {
	const raw = await readFile(getRunLockPath({ cwd }), 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return undefined;
	}

	try {
		return RunLock.parse(JSON.parse(raw));
	} catch {
		return undefined;
	}
};

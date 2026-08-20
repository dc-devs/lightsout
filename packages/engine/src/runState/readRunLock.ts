import { readFile } from 'node:fs/promises';
import { RunLock } from '#src/contracts/index.ts';
import { getRunLockPath } from '#src/runState/common/paths/getRunLockPath.ts';

interface Params {
	cwd: string;
}

/** The current run lock, or undefined when absent or unparseable (the acquirer treats a corrupt lock as stale). */
export const readRunLock = async ({ cwd }: Params): Promise<RunLock | undefined> => {
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

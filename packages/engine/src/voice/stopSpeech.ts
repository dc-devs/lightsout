import { readFile, rm } from 'node:fs/promises';
import { getVoicePidPath } from '#src/voice/common/paths/getVoicePidPath.ts';

interface Params {
	cwd: string;
}

/**
 * Cut off the reading currently playing, if there is one.
 *
 * A pid that has already exited is the ordinary case, not a failure — the
 * reading simply finished on its own — so the kill is best-effort and the
 * bookkeeping file is cleared either way.
 */
export const stopSpeech = async ({ cwd }: Params): Promise<void> => {
	const pidPath = getVoicePidPath({ cwd });
	const raw = await readFile(pidPath, 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return;
	}

	const pid = Number(raw.trim());

	if (Number.isInteger(pid) && pid > 0) {
		try {
			process.kill(pid);
		} catch {
			// already finished
		}
	}

	await rm(pidPath, { force: true });
};

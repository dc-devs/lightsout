import { join } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';

interface Params {
	cwd: string;
}

/**
 * One reservation per repository: `<primary checkout>/.lightsout/gate-lock.json`,
 * beside the run lock the engine already keeps there.
 *
 * Asynchronous where `getRunLockPath` is synchronous, because resolving the
 * shared checkout asks git — which is exactly why `withGateLock` calls this
 * once per gate run and threads the answer, rather than letting it sit inside a
 * two-second poll loop.
 */
export const getGateLockPath = async ({ cwd }: Params): Promise<string> => {
	return join(await resolveSharedStateDir({ cwd }), 'gate-lock.json');
};

import { join } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';

interface Params {
	cwd: string;
}

interface GateHoldPaths {
	/** The holds directory itself, which a reader lists. */
	dir: string;
	/** One ticket's file inside it, named by the lowercased reference. */
	pathFor: ({ identifier }: { identifier: string }) => string;
}

/**
 * Where this repository's holds live: a `gate-holds` folder inside the same
 * shared `.lightsout` directory the gate reservation sits in, so every worktree
 * of one repository reads the same set.
 *
 * Asynchronous where `getRunLockPath` is synchronous, because resolving the
 * primary checkout asks git.
 */
export const getGateHoldPaths = async ({ cwd }: Params): Promise<GateHoldPaths> => {
	const dir = join(await resolveSharedStateDir({ cwd }), 'gate-holds');

	return { dir, pathFor: ({ identifier }) => join(dir, `${identifier.toLowerCase()}.json`) };
};

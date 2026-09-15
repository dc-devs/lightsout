import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { planningPathIdentity } from '#src/plan/workflow/common/evidence/planningPathIdentity.ts';

interface Params {
	cwd: string;
	path: string;
}

/** Read exact regular-file bytes with no link following and reject changed path resolution. */
export const readPlanningBytes = async ({ cwd, path }: Params): Promise<Buffer | undefined> => {
	const before = await planningPathIdentity({ cwd, path });
	if (!before.exists) return undefined;
	if (!before.regularFile) throw new Error(`Requested planning source is not a regular file: ${path}`);
	const handle = await open(join(before.root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const status = await handle.stat();
		if (!status.isFile()) throw new Error(`Requested planning source is not a regular file: ${path}`);
		const bytes = await handle.readFile();
		const afterStatus = await handle.stat();
		const after = await planningPathIdentity({ cwd, path });
		const identity = `${join(before.root, path)}:${status.dev}:${status.ino}:${status.mode}`;
		if (
			!before.identity.endsWith(identity) ||
			before.identity !== after.identity ||
			status.size !== afterStatus.size ||
			status.mtimeMs !== afterStatus.mtimeMs ||
			status.ctimeMs !== afterStatus.ctimeMs
		)
			throw new Error(`Planning source changed during acquisition: ${path}`);
		return bytes;
	} finally {
		await handle.close();
	}
};

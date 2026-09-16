import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

interface Params {
	path: string;
	/** Flush actual command evidence before an immutable receipt references it. */
	flush?: boolean;
}

/** Immutable storage never follows a replaced commit or blob symlink. */
export const readPlanningFile = async ({ path, flush = false }: Params): Promise<Buffer> => {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const status = await handle.stat();
		if (!status.isFile()) throw new Error(`Planning storage entry is not a regular file: ${path}`);
		const bytes = await handle.readFile();
		if (flush) await handle.sync();
		return bytes;
	} finally {
		await handle.close();
	}
};

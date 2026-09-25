import { readFile } from 'node:fs/promises';
import { ShippingProgress } from '#src/contracts/ship/ShippingProgress.ts';
import type { ShippingProgressReading } from '#src/ship/progress/common/types/ShippingProgressReading.ts';
import { getShippingProgressPath } from '#src/ship/progress/common/utils/getShippingProgressPath.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

const isMissingFile = ({ error }: { error: unknown }) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

/**
 * The shipping record filed for a branch, with whether a file was there at all.
 * Never throws: a branch that recorded nothing has a normal answer, and a
 * record that cannot be used is reported rather than raised.
 *
 * A branch no work order claims answers no path at all and nothing recorded,
 * which is the same answer it has always given for a branch that recorded
 * nothing — there was simply never a file it could have been filed at.
 *
 * Only a read that fails with `ENOENT` means missing; any other read failure, a
 * body that is not JSON, or one that does not satisfy the contract means the
 * file is there and unreadable.
 */
export const readShippingProgress = async ({ cwd, branch }: Params): Promise<ShippingProgressReading> => {
	const path = await getShippingProgressPath({ cwd, branch });

	if (path === undefined) {
		return { path: undefined, exists: false, progress: undefined };
	}

	let exists = true;
	let progress: ShippingProgress | undefined;

	try {
		const parsed = ShippingProgress.safeParse(JSON.parse(await readFile(path, 'utf8')));

		progress = parsed.success ? parsed.data : undefined;
	} catch (error) {
		exists = !isMissingFile({ error });
	}

	return { path, exists, progress };
};

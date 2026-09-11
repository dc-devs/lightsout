import { readFile } from 'node:fs/promises';
import { ShippingProgress } from '#src/contracts/index.ts';
import type { ShippingProgressReading } from '#src/ship/progress/common/types/ShippingProgressReading.ts';
import { getShippingProgressPath } from '#src/ship/progress/common/utils/getShippingProgressPath.ts';

interface Params {
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

const isMissingFile = ({ error }: { error: unknown }) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

/**
 * The shipping record filed for a branch in this checkout, with whether a file
 * was there at all. Never throws: a branch that recorded nothing has a normal
 * answer, and a record that cannot be used is reported rather than raised.
 *
 * Only a read that fails with `ENOENT` means missing; any other read failure, a
 * body that is not JSON, or one that does not satisfy the contract means the
 * file is there and unreadable.
 */
export const readShippingProgress = async ({ cwd, branch }: Params): Promise<ShippingProgressReading> => {
	const path = getShippingProgressPath({ cwd, branch });
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

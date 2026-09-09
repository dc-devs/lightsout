import { unlink } from 'node:fs/promises';
import { getGateHoldPaths } from '#src/gates/gateHolds/common/utils/getGateHoldPaths.ts';

interface Params {
	cwd: string;
	identifier: string;
}

/**
 * One ticket's hold, taken off disk — and an absent one swallowed, because two
 * drains can reconcile the same released hold at the same moment and the second
 * removal is an ordinary outcome rather than a failure.
 *
 * Its own file rather than a flag on `writeGateHold`: recording a hold and
 * ending one are different acts, and a boolean parameter would hide which one a
 * call site meant.
 */
export const removeGateHold = async ({ cwd, identifier }: Params): Promise<void> => {
	const { pathFor } = await getGateHoldPaths({ cwd });

	await unlink(pathFor({ identifier })).catch(() => undefined);
};

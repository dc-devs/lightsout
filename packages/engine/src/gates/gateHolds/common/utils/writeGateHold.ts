import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GateHold } from '#src/contracts/index.ts';
import { getGateHoldPaths } from '#src/gates/gateHolds/common/utils/getGateHoldPaths.ts';

interface Params {
	cwd: string;
	identifier: string;
	hold: GateHold;
}

/**
 * One ticket's hold, written to its own file.
 *
 * The directory is created first, because the primary checkout of a repository
 * that has never timed out does not have one — and losing the first hold a
 * repository ever takes would let the very ticket whose gates timed out run
 * again immediately.
 *
 * It never reads or rewrites any other ticket's file. That is the whole reason
 * the record is split per ticket: a writer that touched the folder as a document
 * would drop a hold a second worker recorded a moment earlier.
 */
export const writeGateHold = async ({ cwd, identifier, hold }: Params): Promise<void> => {
	const { pathFor } = await getGateHoldPaths({ cwd });
	const path = pathFor({ identifier });

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(hold), 'utf8');
};

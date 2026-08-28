import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ShipResult } from '#src/contracts/index.ts';
import { getShipResultPath } from '#src/ship/common/utils/getShipResultPath.ts';

interface Params {
	cwd: string;
	result: ShipResult;
}

/**
 * Persist a ship result atomically (tmp file + rename) and answer with the path
 * written.
 *
 * Same shape as `writeRunManifest`, for the same reason: the whole point of the
 * file is that another tool reads it, and a crash mid-write must not leave that
 * tool parsing half a JSON document.
 *
 * A result whose branch is unknown — git itself was unreadable — is filed under
 * the literal name `unknown`, so even that run leaves a record rather than
 * nothing.
 */
export const writeShipResult = async ({ cwd, result }: Params): Promise<string> => {
	const resultPath = getShipResultPath({ cwd, branch: result.branch ?? 'unknown' });
	const tmpPath = `${resultPath}.tmp`;

	await mkdir(dirname(resultPath), { recursive: true });
	await writeFile(tmpPath, `${JSON.stringify(result, null, '\t')}\n`, 'utf8');
	await rename(tmpPath, resultPath);

	return resultPath;
};

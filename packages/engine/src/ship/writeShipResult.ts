import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ShipResult } from '#src/contracts/ship/ShipResult.ts';
import { getShipResultPath } from '#src/ship/common/utils/getShipResultPath.ts';

interface Params {
	cwd: string;
	result: ShipResult;
}

/**
 * Persist a ship result atomically (tmp file + rename) and answer with the path
 * written, or undefined when there was nowhere to write it.
 *
 * Same shape as `writeRunManifest`, for the same reason: the whole point of the
 * file is that another tool reads it, and a crash mid-write must not leave that
 * tool parsing half a JSON document.
 *
 * A result whose branch no work order claims — including a run whose branch git
 * could not name at all — is filed nowhere. The forge stays ship's durable
 * record of what happened, which is what `findPullRequest` recovers from, so
 * nothing that matters is lost with the local copy.
 */
export const writeShipResult = async ({ cwd, result }: Params): Promise<string | undefined> => {
	const resultPath = result.branch === undefined ? undefined : await getShipResultPath({ cwd, branch: result.branch });

	if (resultPath === undefined) {
		return undefined;
	}

	const tmpPath = `${resultPath}.tmp`;

	await mkdir(dirname(resultPath), { recursive: true });
	await writeFile(tmpPath, `${JSON.stringify(result, null, '\t')}\n`, 'utf8');
	await rename(tmpPath, resultPath);

	return resultPath;
};

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StandardsSnapshot } from '#src/contracts/index.ts';
import { getStandardsCheckPath } from '#src/standardsCheck/common/paths/getStandardsCheckPath.ts';
import { getStandardsSnapshotsDir } from '#src/standardsCheck/common/paths/getStandardsSnapshotsDir.ts';

interface Params {
	cwd: string;
	/** Absent reads the latest snapshot; a dated file name reads that one. */
	fileName?: string;
}

/**
 * One persisted check result, validated at the boundary.
 *
 * `undefined` when the file is absent or will not parse: a repo that has never
 * run a check is a normal state a reader has to render, not an error — and a
 * snapshot written by an older engine is no more readable than a missing one.
 */
export const readStandardsSnapshot = async ({ cwd, fileName }: Params): Promise<StandardsSnapshot | undefined> => {
	const path = fileName === undefined ? getStandardsCheckPath({ cwd }) : join(getStandardsSnapshotsDir({ cwd }), fileName);
	const raw = await readFile(path, 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return undefined;
	}

	try {
		const parsed = StandardsSnapshot.safeParse(JSON.parse(raw));

		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};

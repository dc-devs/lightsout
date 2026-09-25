import { readFile } from 'node:fs/promises';
import { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { getRunManifestPath } from '#src/runState/common/paths/getRunManifestPath.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Load a run's manifest from disk. The run's directory is resolved first, so a
 * run answers to the shortened id its report printed — and the id is not
 * resolved a second time, since one lookup already answered where the manifest
 * is. Validated at the boundary — a manifest that doesn't parse is a hard
 * error, never a guess.
 */
export const readRunManifest = async ({ cwd, runId }: Params): Promise<RunManifest> => {
	const raw = await readFile(await getRunManifestPath({ cwd, runId }), 'utf8');

	return RunManifest.parse(JSON.parse(raw));
};

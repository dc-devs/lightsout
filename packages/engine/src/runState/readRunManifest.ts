import { readFile } from 'node:fs/promises';
import { RunManifest } from '#src/contracts/index.ts';
import { getRunManifestPath } from '#src/runState/common/paths/getRunManifestPath.ts';
import { resolveRunId } from '#src/runState/common/paths/resolveRunId.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Load a run's manifest from disk. The id is resolved first, so a run answers
 * to the shortened id its report printed. Validated at the boundary — a
 * manifest that doesn't parse is a hard error, never a guess.
 */
export const readRunManifest = async ({ cwd, runId }: Params): Promise<RunManifest> => {
	const resolved = await resolveRunId({ cwd, runId });
	const raw = await readFile(getRunManifestPath({ cwd, runId: resolved }), 'utf8');

	return RunManifest.parse(JSON.parse(raw));
};

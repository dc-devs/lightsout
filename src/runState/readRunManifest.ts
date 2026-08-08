import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunManifest } from '@/contracts';
import { getRunDir } from '@/runState/common/paths/getRunDir';
import { resolveRunId } from '@/runState/common/paths/resolveRunId';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Load a run's manifest from disk. The id is resolved first, so a run answers
 * to the shortened id its report printed. Validated at the boundary — a
 * manifest that doesn't parse is a hard error, never a guess.
 */
export const readRunManifest = async ({ cwd, runId }: Params) => {
	const resolved = await resolveRunId({ cwd, runId });
	const raw = await readFile(join(getRunDir({ cwd, runId: resolved }), 'manifest.json'), 'utf8');

	return RunManifest.parse(JSON.parse(raw));
};

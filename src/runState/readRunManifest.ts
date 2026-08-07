import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunManifest } from '@/contracts';
import { getRunDir } from '@/runState/getRunDir';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Load a run's manifest from disk. Validated at the boundary — a manifest
 * that doesn't parse is a hard error, never a guess.
 */
export const readRunManifest = async ({ cwd, runId }: Params) => {
	const raw = await readFile(join(getRunDir({ cwd, runId }), 'manifest.json'), 'utf8');

	return RunManifest.parse(JSON.parse(raw));
};

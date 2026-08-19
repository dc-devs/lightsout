import { rename, writeFile } from 'node:fs/promises';
import type { RunManifest } from '@/contracts';
import { getRunManifestPath } from '@/runState/common/paths/getRunManifestPath';

interface Params {
	cwd: string;
	manifest: RunManifest;
}

/**
 * Persist a manifest atomically (tmp file + rename) so a crash mid-write can
 * never leave a half-written manifest — the resume path depends on this file
 * always being valid JSON. Stamps `updatedAt`; returns the stamped manifest.
 */
export const writeRunManifest = async ({ cwd, manifest }: Params): Promise<RunManifest> => {
	const stamped: RunManifest = { ...manifest, updatedAt: new Date().toISOString() };
	const manifestPath = getRunManifestPath({ cwd, runId: manifest.runId });
	const tmpPath = `${manifestPath}.tmp`;

	await writeFile(tmpPath, `${JSON.stringify(stamped, null, '\t')}\n`, 'utf8');
	await rename(tmpPath, manifestPath);

	return stamped;
};

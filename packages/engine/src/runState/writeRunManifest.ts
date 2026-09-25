import { rename, writeFile } from 'node:fs/promises';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { getRunManifestPath } from '#src/runState/internal/common/paths/getRunManifestPath.ts';

interface Params {
	cwd: string;
	manifest: RunManifest;
}

/**
 * Persist a manifest atomically (tmp file + rename) so a crash mid-write can
 * never leave a half-written manifest — the resume path depends on this file
 * always being valid JSON. Stamps `updatedAt`; returns the stamped manifest.
 *
 * The path comes from a lookup that throws for an unknown run, so a write can
 * no longer land in a directory nobody created.
 */
export const writeRunManifest = async ({ cwd, manifest }: Params): Promise<RunManifest> => {
	const stamped: RunManifest = { ...manifest, updatedAt: new Date().toISOString() };
	const manifestPath = await getRunManifestPath({ cwd, runId: manifest.runId });
	const tmpPath = `${manifestPath}.tmp`;

	await writeFile(tmpPath, `${JSON.stringify(stamped, null, '\t')}\n`, 'utf8');
	await rename(tmpPath, manifestPath);

	return stamped;
};

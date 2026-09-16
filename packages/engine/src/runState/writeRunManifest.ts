import { rename, writeFile } from 'node:fs/promises';
import type { RunManifest } from '#src/contracts/index.ts';
import { getRunManifestPath } from '#src/runState/common/paths/getRunManifestPath.ts';
import { validateRunHandoff } from '#src/runState/common/utils/validateRunHandoff.ts';
import { readRunManifest } from '#src/runState/readRunManifest.ts';

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
	const previous = await readRunManifest({ cwd, runId: manifest.runId }).catch((error: unknown) => {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
		throw error;
	});
	validateRunHandoff({ previous, manifest });
	const stamped: RunManifest = { ...manifest, updatedAt: new Date().toISOString() };
	const manifestPath = getRunManifestPath({ cwd, runId: manifest.runId });
	const tmpPath = `${manifestPath}.tmp`;

	await writeFile(tmpPath, `${JSON.stringify(stamped, null, '\t')}\n`, 'utf8');
	await rename(tmpPath, manifestPath);

	return stamped;
};

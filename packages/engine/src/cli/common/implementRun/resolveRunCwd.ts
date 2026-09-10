import { stat } from 'node:fs/promises';
import type { RunManifest } from '#src/contracts/index.ts';

interface Params {
	/** The checkout the command was launched from — where the run's records live. */
	cwd: string;
	/** The run's manifest, already read from `cwd`. */
	manifest: RunManifest;
}

/**
 * The checkout a recorded run's work happens in: the workspace its manifest
 * recorded when that directory is still there, and the launching checkout when
 * the run recorded none.
 *
 * A recorded workspace that has gone is an error naming the path rather than a
 * silent fall back, because rebuilding in the checkout the command was launched
 * from would gate and commit a tree the run was never building in.
 *
 * It is a resolver over the manifest alone — it never lists worktrees and never
 * creates one, which is what locating a run's recorded workspace means as
 * against making a second.
 */
export const resolveRunCwd = async ({ cwd, manifest }: Params): Promise<{ workspace: string } | { error: string }> => {
	const { workspace } = manifest;

	if (workspace === undefined) {
		return { workspace: cwd };
	}

	const isDirectory = await stat(workspace).then(
		(entry) => entry.isDirectory(),
		() => false,
	);

	return isDirectory ? { workspace } : { error: `run ${manifest.runId} recorded its workspace at ${workspace}, and there is no checkout there any more` };
};

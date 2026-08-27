import { findRepoRoot } from '#src/common/utils/findRepoRoot.ts';
import type { LightsoutReader } from '#src/lightsout/common/types/LightsoutReader.ts';
import { FixtureReader } from '#src/lightsout/FixtureReader.ts';
import { InProcessReader } from '#src/lightsout/InProcessReader.ts';

/**
 * The reader this process talks to — the single place the implementation is
 * chosen, and the only file that changes when the hosted one arrives.
 *
 * Whether a repo was found is the whole switch. It is the same question the
 * navigation asks, so a build showing no "Your repo" zone cannot also be reading
 * somebody's disk, and a deployment started from inside a checkout is made
 * public with the `LIGHTSOUT_PUBLIC=1` that `findRepoRoot` already honours. A
 * flag of this file's own would be a second switch to keep in step with the
 * first.
 *
 * A fresh instance per call, built from the repo root as it reads right now, so
 * a dev server restarted against a different repo is answered by the next call
 * rather than by whatever module scope captured first.
 */
export const getReader = (): LightsoutReader => {
	const repoRoot = findRepoRoot();

	return repoRoot === undefined ? new FixtureReader() : new InProcessReader({ repoRoot });
};

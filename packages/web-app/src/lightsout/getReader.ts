import { getRepoRoot } from '#src/common/utils/getRepoRoot.ts';
import type { LightsoutReader } from '#src/lightsout/common/types/LightsoutReader.ts';
import { InProcessReader } from '#src/lightsout/InProcessReader.ts';

/**
 * The reader this process talks to — the single place the implementation is
 * chosen, and the only file that changes when the hosted one arrives.
 *
 * A fresh instance per call, built from the repo root as it reads right now, so
 * a dev server restarted against a different repo is answered by the next call
 * rather than by whatever module scope captured first.
 */
export const getReader = (): LightsoutReader => new InProcessReader({ repoRoot: getRepoRoot() });

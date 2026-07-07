import { join } from 'node:path';
import { mintRunId } from './mintRunId';

interface Params {
	cwd: string;
	/** The run-kind subdirectory under `.lightsout/` — a fresh run mints an id, a resume reuses one. */
	kind: 'traverse' | 'debug';
	resumeRunId?: string;
}

interface RunDir {
	runId: string;
	runDir: string;
	tracePath: string;
}

/**
 * Resolve a run's on-disk location: its id (minted fresh, or reused on resume),
 * its `.lightsout/<kind>/<runId>` directory, and its trace path. Shared by the
 * traverse and debug loops, which differ only in the kind segment.
 */
export const resolveRunDir = ({ cwd, kind, resumeRunId }: Params): RunDir => {
	const runId = resumeRunId ?? mintRunId();
	const runDir = join(cwd, '.lightsout', kind, runId);
	const tracePath = join(runDir, 'trace.json');

	return { runId, runDir, tracePath };
};

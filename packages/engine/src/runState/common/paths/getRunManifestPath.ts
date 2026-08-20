import { join } from 'node:path';
import { getRunDir } from '#src/runState/common/paths/getRunDir.ts';

interface Params {
	cwd: string;
	runId: string;
}

/** One manifest per run: `<repo>/.lightsout/runs/<runId>/manifest.json`. */
export const getRunManifestPath = ({ cwd, runId }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'manifest.json');
};

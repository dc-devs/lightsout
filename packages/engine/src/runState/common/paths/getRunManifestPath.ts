import { join } from 'node:path';
import { getRunDir } from '@/runState/common/paths/getRunDir';

interface Params {
	cwd: string;
	runId: string;
}

/** One manifest per run: `<repo>/.lightsout/runs/<runId>/manifest.json`. */
export const getRunManifestPath = ({ cwd, runId }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'manifest.json');
};

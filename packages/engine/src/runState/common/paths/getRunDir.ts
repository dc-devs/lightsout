import { join } from 'node:path';
import { getRunsDir } from '#src/runState/common/paths/getRunsDir.ts';

interface Params {
	cwd: string;
	runId: string;
}

/** Run state lives inside the target repo: `<repo>/.lightsout/runs/<runId>`. */
export const getRunDir = ({ cwd, runId }: Params): string => {
	return join(getRunsDir({ cwd }), runId);
};

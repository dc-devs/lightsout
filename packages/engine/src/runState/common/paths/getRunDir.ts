import { join } from 'node:path';
import { getRunsDir } from '@/runState/common/paths/getRunsDir';

interface Params {
	cwd: string;
	runId: string;
}

/** Run state lives inside the target repo: `<repo>/.lightsout/runs/<runId>`. */
export const getRunDir = ({ cwd, runId }: Params) => {
	return join(getRunsDir({ cwd }), runId);
};

import { join } from 'node:path';

interface Params {
	cwd: string;
	runId: string;
}

/** Run state lives inside the target repo: `<repo>/.lightsout/runs/<runId>`. */
export const getRunDir = ({ cwd, runId }: Params) => {
	return join(cwd, '.lightsout', 'runs', runId);
};

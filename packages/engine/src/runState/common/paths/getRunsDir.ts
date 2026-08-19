import { join } from 'node:path';

interface Params {
	cwd: string;
}

/** Every run's state gathers in one place: `<repo>/.lightsout/runs`. */
export const getRunsDir = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'runs');
};

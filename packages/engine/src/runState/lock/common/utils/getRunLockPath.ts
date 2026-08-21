import { join } from 'node:path';

interface Params {
	cwd: string;
}

/** One lock per consumer repo: `<repo>/.lightsout/lock.json`. */
export const getRunLockPath = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'lock.json');
};

import { join } from 'node:path';

interface Params {
	cwd: string;
}

/** The latest snapshot, overwritten each run: `<repo>/.lightsout/standards-check.json`. */
export const getStandardsCheckPath = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'standards-check.json');
};

import { join } from 'node:path';

interface Params {
	cwd: string;
}

/** One append-only friction log per consumer repo: `<repo>/.lightsout/friction.jsonl`. */
export const getFrictionPath = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'friction.jsonl');
};

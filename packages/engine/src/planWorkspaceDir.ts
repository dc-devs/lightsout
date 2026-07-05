import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
}

/** The transient, gitignored workspace root for a plan (`facts.json`, etc.). */
export const planWorkspaceDir = ({ cwd, name }: Params): string => join(cwd, '.lightsout', 'plans', name);

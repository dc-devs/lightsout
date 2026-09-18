import { join } from 'node:path';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the plan folder the record lives in. */
	name: string;
}

/** A plan's planning record lives beside its other working files: `<plan folder>/planning-progress.json`. */
export const getPlanningProgressPath = async ({ cwd, name }: Params): Promise<string> => join(await planWorkspaceDir({ cwd, name }), 'planning-progress.json');

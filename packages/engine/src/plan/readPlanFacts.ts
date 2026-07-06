import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlanFacts } from '@lightsout/contracts';
import { planWorkspaceDir } from './planWorkspaceDir';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
}

/**
 * Read and validate a plan workspace's `facts.json`. Boundary validation:
 * a missing or corrupt file is a hard error, never a silent empty result.
 */
export const readPlanFacts = async ({ cwd, name }: Params): Promise<PlanFacts> => {
	const factsPath = join(planWorkspaceDir({ cwd, name }), 'facts.json');
	const raw = await readFile(factsPath, 'utf8').catch(() => {
		throw new Error(`no facts found for plan ${name} at ${factsPath} — run: lightsout plan explore`);
	});

	return PlanFacts.parse(JSON.parse(raw));
};

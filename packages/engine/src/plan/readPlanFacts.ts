import { PlanFacts } from '@lightsout/contracts';
import { readPlanWorkspaceFile } from './common/utils/readPlanWorkspaceFile';

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
	return readPlanWorkspaceFile({
		cwd,
		name,
		fileName: 'facts.json',
		schema: PlanFacts,
		notFound: (filePath) => `no facts found for plan ${name} at ${filePath} — run: lightsout plan explore`,
	});
};

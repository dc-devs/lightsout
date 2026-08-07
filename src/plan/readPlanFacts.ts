import { PlanFacts } from '@/contracts';
import { readPlanWorkspaceFile } from '@/plan/common/utils/readPlanWorkspaceFile';

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
		notFound: (filePath) => `no facts found for plan ${name} at ${filePath} — author facts.json ({ request, areas }), then run: lightsout plan verify-facts --name ${name}`,
	});
};

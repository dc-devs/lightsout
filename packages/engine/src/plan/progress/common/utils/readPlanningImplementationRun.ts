import { relative } from 'node:path';
import type { PlanningCanonicalProgress } from '#src/contracts/index.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { listRunIds, readRunManifest } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	name: string;
}

/**
 * The implement run this repo holds for a plan, latest write first, or
 * undefined when it holds none.
 *
 * Planning readiness and implementation outcome are different facts, and a
 * cheap planning bill says nothing about either — so this reads the run's own
 * manifest rather than inferring anything from the planning store. A run
 * whose manifest cannot be parsed is skipped rather than guessed at: the
 * caller's "unavailable" is the honest answer for it.
 */
export const readPlanningImplementationRun = async ({ cwd, name }: Params): Promise<PlanningCanonicalProgress['implementation']> => {
	const folder = `${relative(cwd, planWorkspaceDir({ cwd, name }))}/`;
	const runIds = await listRunIds({ cwd });
	const manifests = [];

	for (const runId of runIds) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest?.plan.startsWith(folder)) {
			manifests.push(manifest);
		}
	}

	const [latest] = manifests.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

	return latest === undefined ? undefined : { runId: latest.runId, status: latest.status };
};

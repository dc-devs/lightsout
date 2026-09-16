import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { PlanningProgress } from '#src/contracts/index.ts';
import { readCanonicalPlanningProgress } from '#src/plan/progress/common/utils/readCanonicalPlanningProgress.ts';
import { getPlanningProgressPath } from '#src/plan/progress/getPlanningProgressPath.ts';

interface Params {
	cwd: string;
	name: string;
}

/**
 * What a plan folder records about its own planning, preferring the canonical
 * store and falling back to `planning-progress.json` only when the store holds
 * no verified generation.
 *
 * Undefined means nothing usable was found: no record was ever written, the
 * legacy file is not JSON or is off-contract, or the canonical store is there
 * and does not verify. That last case is deliberately not a fall-through — a
 * store whose chain is broken would otherwise be answered with an older legacy
 * file still showing five passed steps, which is a completed plan the repo can
 * no longer prove it has.
 */
export const readPlanningProgress = async ({ cwd, name }: Params): Promise<PlanningProgress | undefined> => {
	const canonical = await readCanonicalPlanningProgress({ cwd, name }).catch(() => null);

	if (canonical === null) {
		return undefined;
	}

	if (canonical !== undefined) {
		return { name, updatedAt: new Date().toISOString(), steps: [], canonical };
	}

	return readJsonFile({ path: getPlanningProgressPath({ cwd, name }), schema: PlanningProgress });
};

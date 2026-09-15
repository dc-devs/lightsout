import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { type PlanningDependency, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningPathIdentity } from '#src/plan/workflow/common/evidence/planningPathIdentity.ts';
import { readPlanningDirectory } from '#src/plan/workflow/common/evidence/readPlanningDirectory.ts';
import { readPlanningSource } from '#src/plan/workflow/common/evidence/readPlanningSource.ts';

interface Params {
	cwd: string;
	dependency: Extract<PlanningDependency, { kind: typeof PlanningVocabulary.Dependency.Content | typeof PlanningVocabulary.Dependency.Absence }>;
}

/** Absence can become either a file or a directory; both are ordinary freshness changes requiring new investigation. */
export const fingerprintPlanningPath = async ({ cwd, dependency }: Params): Promise<PlanningDependency> => {
	const { id, path } = dependency;
	const address = await planningPathIdentity({ cwd, path });
	if (!address.exists) return { id, kind: PlanningVocabulary.Dependency.Absence, path };
	const status = await lstat(join(address.root, path));
	let observed: PlanningDependency;
	if (status.isDirectory()) {
		const directory = await readPlanningDirectory({ cwd, path });
		if (directory === undefined) throw new Error(`Planning dependency disappeared while revalidating: ${path}`);
		observed = {
			id,
			kind: PlanningVocabulary.Dependency.Membership,
			root: path,
			policy: { exclude: [], recursive: false },
			fingerprint: directory.fingerprint,
		};
	} else {
		const source = await readPlanningSource({ cwd, path });
		if (source === undefined) throw new Error(`Planning dependency disappeared while revalidating: ${path}`);
		observed = { id, kind: PlanningVocabulary.Dependency.Content, path, sha256: source.sha256 };
	}
	return observed;
};

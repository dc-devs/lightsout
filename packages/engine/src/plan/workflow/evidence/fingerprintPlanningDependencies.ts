import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningDependency, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { fingerprintPlanningPath } from '#src/plan/workflow/common/evidence/fingerprintPlanningPath.ts';
import { fingerprintUnknownPlanningReach } from '#src/plan/workflow/common/evidence/fingerprintUnknownPlanningReach.ts';
import { planningCollectionDigests } from '#src/plan/workflow/common/evidence/planningCollectionDigests.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';
import { readPlanningDirectory } from '#src/plan/workflow/common/evidence/readPlanningDirectory.ts';
import { readPlanningUniverse } from '#src/plan/workflow/common/evidence/readPlanningUniverse.ts';
import { searchPlanningUniverse } from '#src/plan/workflow/common/evidence/searchPlanningUniverse.ts';
import type { PlanningEvidencePolicy } from '#src/plan/workflow/common/types/PlanningEvidencePolicy.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';

interface Params {
	cwd: string;
	dependencies: PlanningDependency[];
	record: PlanningRecord;
	standards: PlanningStandards;
	policy: PlanningEvidencePolicy;
}

/** Revalidate concrete IO predicates; unknown reach remains explicit and requires conservative review. */
export const fingerprintPlanningDependencies = async ({
	cwd,
	dependencies,
	record,
	policy,
}: Params): Promise<{
	current: boolean;
	changed: string[];
	unknown: boolean;
	dependencies: PlanningDependency[];
}> => {
	const observed: PlanningDependency[] = [];
	const changed: string[] = [];
	let unknown = false;
	for (const dependency of dependencies) {
		let next: PlanningDependency;
		switch (dependency.kind) {
			case PlanningVocabulary.Dependency.Content:
			case PlanningVocabulary.Dependency.Absence: {
				next = await fingerprintPlanningPath({ cwd, dependency });
				break;
			}
			case PlanningVocabulary.Dependency.Search: {
				const result = await searchPlanningUniverse({
					cwd,
					request: {
						requestId: dependency.id,
						operation: PlanningVocabulary.Operation.Search,
						roots: dependency.roots,
						query: dependency.query,
						options: dependency.options,
						reason: 'Revalidate recorded search',
					},
				});
				next = { ...dependency, universeFingerprint: result.universeFingerprint, resultFingerprint: result.resultFingerprint };
				unknown ||= result.unknown;
				break;
			}
			case PlanningVocabulary.Dependency.Membership: {
				if (dependency.policy.recursive === false) {
					const result = await readPlanningDirectory({ cwd, path: dependency.root, exclude: dependency.policy.exclude });
					next = { ...dependency, fingerprint: result?.fingerprint ?? sha256({ content: 'missing' }) };
					unknown ||= result?.entries.some((entry) => entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) ?? false;
					break;
				}
				const result = await readPlanningUniverse({ cwd, roots: [dependency.root], exclude: dependency.policy.exclude, hashFiles: false });
				next = { ...dependency, fingerprint: sha256({ content: canonicalJson({ value: result.members }) }) };
				unknown ||= result.unknown;
				break;
			}
			case PlanningVocabulary.Dependency.Collection:
				next = { ...dependency, memberDigests: planningCollectionDigests({ record, dependency }) };
				break;
			case PlanningVocabulary.Dependency.Unknown: {
				const effectivePolicy = dependency.policy ?? planningEvidencePolicy({ exclude: policy.exclude });
				next = {
					...dependency,
					policy: effectivePolicy,
					fallbackFingerprint: await fingerprintUnknownPlanningReach({ cwd, roots: dependency.roots, policy: effectivePolicy }),
				};
				unknown = true;
				break;
			}
		}
		observed.push(next);
		if (canonicalJson({ value: dependency }) !== canonicalJson({ value: next })) changed.push(dependency.id);
	}
	return { current: changed.length === 0, changed, unknown, dependencies: observed };
};

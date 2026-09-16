import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { PlanningStandardsBundle, PlanningVocabulary } from '#src/contracts/index.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
}

/** Acquire once for the plan-wide scope and retry only publication when an unrelated writer wins. */
export const commitPlanningStandards = async ({ runtime }: Params): Promise<{ snapshot: PlanningSnapshot; standards: PlanningStandards }> => {
	const standards = await resolvePlanningStandards({
		cwd: runtime.cwd,
		config: runtime.config,
		role: PlanningVocabulary.Role.Architect,
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
	});
	if (runtime.executionPolicy && runtime.executionPolicy.policy.standardsPolicyDigest !== standards.policyDigest)
		throw new Error('Planning standards changed; stop and re-enter to adopt the updated policy');
	const bundle = PlanningStandardsBundle.parse({
		format: 'planning-standards-v1',
		policyDigest: standards.policyDigest,
		observations: standards.observations,
		channels: standards.channels,
	});
	const text = canonicalJson({ value: bundle });
	const snapshot = await updatePlanningSnapshot({
		runtime,
		propose: async (current) => {
			if (
				current.artifacts.get('planning-standards.json') === text &&
				current.record.sources.every((source) => current.artifacts.has(`planning-originals/${source.sha256}.txt`))
			)
				return undefined;
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			for (const source of record.sources) {
				const path = `planning-originals/${source.sha256}.txt`;
				if (!artifacts.has(path)) {
					artifacts.set(path, source.text);
					record.artifacts.push(planningDataArtifact({ path, content: source.text }));
				}
			}
			record.standards = standards.channels.map(({ text: _text, ...descriptor }) => ({ ...descriptor, artifact: 'planning-standards.json' }));
			attachPlanningData({ record, artifacts, path: 'planning-standards.json', value: bundle });
			return { record, artifacts };
		},
	});
	return { snapshot, standards };
};

import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningEvidence, PlanningVocabulary } from '#src/contracts/index.ts';
import { fingerprintUnknownPlanningReach } from '#src/plan/workflow/common/evidence/fingerprintUnknownPlanningReach.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';

interface Params {
	cwd: string;
	evidence: PlanningEvidence;
}

/** Preserve declared uncertainty with engine-observed drift detection, without claiming hidden information was acquired. */
export const normalizePlanningUnknownEvidence = async ({ cwd, evidence }: Params): Promise<PlanningEvidence> => {
	if (
		evidence.dependencyReach !== PlanningVocabulary.DependencyReach.Unknown ||
		evidence.dependencies.some((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown)
	)
		return evidence;
	const roots = ['.'];
	const policy = planningEvidencePolicy();
	const fallbackFingerprint = await fingerprintUnknownPlanningReach({ cwd, roots, policy });
	return {
		...evidence,
		dependencies: [
			...evidence.dependencies,
			{
				id: `unknown:semantic:${sha256({ content: evidence.id })}`,
				kind: PlanningVocabulary.Dependency.Unknown,
				roots,
				reason: `Semantic evidence ${evidence.id} explicitly reports unknown dependency reach.`,
				policy,
				fallbackFingerprint,
			},
		],
	};
};

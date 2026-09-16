import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type LightsoutConfig, type PlanningReadiness, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { collectPlanningDependencies } from '#src/plan/workflow/common/utils/collectPlanningDependencies.ts';
import { readCommittedPlanningStandards } from '#src/plan/workflow/common/utils/readCommittedPlanningStandards.ts';
import { readPlanningCompletion } from '#src/plan/workflow/completion/readPlanningCompletion.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';
import { validatePlanningArtifacts } from '#src/plan/workflow/draft/index.ts';
import { fingerprintPlanningDependencies } from '#src/plan/workflow/evidence/index.ts';
import { hasPlanningProposalApproval } from '#src/plan/workflow/proposal/index.ts';
import { evaluatePlanningReadiness } from '#src/plan/workflow/review/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	snapshot: PlanningSnapshot;
	stage: PlanningRuntime['stage'];
}

/** Recheck the completed cycle's concrete inputs and proofs before a publication boundary; this never dispatches or advances work. */
export const inspectPlanningCompletion = async ({ cwd, config, snapshot, stage }: Params): Promise<PlanningReadiness> => {
	const completion = readPlanningCompletion({ snapshot, stage });
	const standards = await resolvePlanningStandards({
		cwd,
		config,
		role: PlanningVocabulary.Role.Architect,
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
	});
	const committed = readCommittedPlanningStandards({ snapshot });
	const dependencies = collectPlanningDependencies({ snapshot });
	const observed = await fingerprintPlanningDependencies({
		cwd,
		record: snapshot.record,
		standards,
		dependencies,
		policy: planningEvidencePolicy({ exclude: [] }),
	});
	const structural = await validatePlanningArtifacts({ runtime: { cwd, name: snapshot.record.planName, config }, snapshot, artifacts: snapshot.artifacts });
	const readiness = evaluatePlanningReadiness({
		snapshot,
		structural,
		stage,
		assurance: completion?.assurance,
		dependenciesCurrent:
			completion !== undefined &&
			observed.current &&
			canonicalJson({
				value: { format: 'planning-standards-v1', policyDigest: standards.policyDigest, observations: standards.observations, channels: standards.channels },
			}) === canonicalJson({ value: committed }),
	});
	if (stage === PlanningVocabulary.Stage.Implementation && !hasPlanningProposalApproval({ snapshot, config }))
		return { ...readiness, ready: false, missingReason: 'The current proposal requires explicit approval.' };
	return completion
		? readiness
		: { ...readiness, ready: false, missingReason: 'The current generation has no completed engine cycle; continue planning before publishing readiness.' };
};

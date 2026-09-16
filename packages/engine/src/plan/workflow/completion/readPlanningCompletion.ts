import { planningIntegrationBasis } from '#src/plan/workflow/common/review/planningIntegrationBasis.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { PlanningCompletionReceipt } from '#src/plan/workflow/completion/common/types/PlanningCompletionReceipt.ts';

interface Params {
	snapshot: PlanningSnapshot;
	stage: PlanningRuntime['stage'];
}

/** Completion is usable only for the unchanged semantic authority and execution policy that the engine actually finished. */
export const readPlanningCompletion = ({ snapshot, stage }: Params): PlanningCompletionReceipt | undefined => {
	const receipt = readPlanningProof({ snapshot, path: `planning-completion/${stage}.json`, schema: PlanningCompletionReceipt });
	return receipt?.stage === stage &&
		receipt.basis === planningIntegrationBasis({ snapshot }) &&
		receipt.executionPolicyDigest === snapshot.record.executionPolicies?.find((policy) => policy.stage === stage)?.sha256
		? receipt
		: undefined;
};

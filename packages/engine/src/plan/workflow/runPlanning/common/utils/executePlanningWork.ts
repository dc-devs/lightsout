import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRunResult, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { applyPlanningResult } from '#src/plan/workflow/applyPlanningResult/index.ts';
import { planningSemanticBasis } from '#src/plan/workflow/common/runtime/planningSemanticBasis.ts';
import { recordPlanningFailure } from '#src/plan/workflow/common/runtime/recordPlanningFailure.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { PlanningInvocationFailure } from '#src/plan/workflow/common/services/PlanningInvocationFailure.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { invokePlanningRole } from '#src/plan/workflow/invokePlanningRole.ts';
import type { PlanningCycle } from '#src/plan/workflow/runPlanning/common/types/PlanningCycle.ts';
import { selectPlanningWork } from '#src/plan/workflow/selectPlanningWork.ts';
import { claimPlanningAttempt } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	cycle: PlanningCycle;
}

const dispatchClaim = async ({
	runtime,
	selected,
	claim,
}: {
	runtime: PlanningRuntime;
	selected: PlanningWork;
	claim: Awaited<ReturnType<typeof claimPlanningAttempt>>;
}): Promise<{ snapshot: PlanningSnapshot; result?: PlanningRunResult }> => {
	let snapshot = claim.snapshot;
	let result: PlanningRunResult | undefined;
	const selectedId = selected.id;
	const work = claim.snapshot.record.work.find((item) => item.id === selectedId);
	if (!work?.currentAttemptId) throw new Error('Claimed work requires its current attempt');
	runtime.onProgress?.(`Planning ${work.role}: ${work.assignment}`);
	try {
		const result =
			work.role === PlanningVocabulary.Role.Draft || work.role === PlanningVocabulary.Role.Repair
				? await runtime.services.draft({ runtime, snapshot: claim.snapshot, work })
				: work.role === PlanningVocabulary.Role.IntegrationReview
					? await runtime.services.integration({ runtime, snapshot: claim.snapshot })
					: await invokePlanningRole({ runtime, snapshot: claim.snapshot, work });
		const applied = await applyPlanningResult({ runtime, result });
		snapshot = applied.snapshot;
		if (!applied.accepted)
			snapshot = await recordPlanningFailure({
				runtime,
				workId: work.id,
				attemptId: work.currentAttemptId,
				failure: applied.reason ?? 'The role response lost current input authority.',
			});
	} catch (error) {
		snapshot =
			error instanceof PlanningInvocationFailure && error.preserveAttempt
				? claim.snapshot
				: await recordPlanningFailure({ runtime, workId: work.id, attemptId: work.currentAttemptId, failure: messageOf({ error }) });
		if (error instanceof PlanningInvocationFailure && error.externallyBlocked)
			result = {
				status: PlanningVocabulary.Status.ExternallyBlocked,
				name: runtime.name,
				generation: snapshot.digest,
				continuation: runtime.name,
				cause: error.message,
			};
	}
	return { snapshot, ...(result ? { result } : {}) };
};

const executeSelected = async ({
	runtime,
	snapshot,
	selected,
}: {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	selected: PlanningWork;
}): Promise<{ snapshot: PlanningSnapshot; result?: PlanningRunResult }> => {
	let outcome: { snapshot: PlanningSnapshot; result?: PlanningRunResult } | undefined;
	if (selected.status === PlanningVocabulary.WorkState.Pending) {
		const selectedId = selected.id;
		snapshot = await updatePlanningSnapshot({
			runtime,
			propose: async (current) => {
				const record = structuredClone(current.record);
				const work = record.work.find((item) => item.id === selectedId);
				if (!work || work.status !== PlanningVocabulary.WorkState.Pending) return undefined;
				work.inputDigest = planningSemanticBasis({ record, work }).digest;
				return { record, artifacts: current.artifacts };
			},
		});
		const refreshed = snapshot.record.work.find((work) => work.id === selectedId);
		if (!refreshed) throw new Error('Selected planning work disappeared');
		selected = refreshed;
	}
	const claim = await claimPlanningAttempt({ runtime, workId: selected.id, expectedInputDigest: selected.inputDigest });
	if (!claim.claimed) {
		await new Promise((resolve) => setTimeout(resolve, 250));
	} else {
		outcome = await dispatchClaim({ runtime, selected, claim });
	}

	return outcome ?? { snapshot };
};

/** Dispatch only a won attempt, preserving real failures and diagnosing actionable stalls without a completion budget. */
export const executePlanningWork = async ({ runtime, cycle }: Params): Promise<{ snapshot: PlanningSnapshot; result?: PlanningRunResult }> => {
	let { snapshot } = cycle;
	let outcome: { snapshot: PlanningSnapshot; result?: PlanningRunResult } | undefined;
	const { structural, readiness } = cycle;
	const pending = snapshot.record.work.filter((work) => work.stage === runtime.stage && work.status !== PlanningVocabulary.WorkState.Complete);
	const selected = selectPlanningWork({ snapshot, stage: runtime.stage }).work[0];
	if (!selected) {
		if (pending.some((work) => work.status === PlanningVocabulary.WorkState.Running)) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		} else {
			snapshot = await updatePlanningSnapshot({
				runtime,
				propose: async (current) => {
					const record = structuredClone(current.record);
					const digest = sha256({ content: canonicalJson({ value: { structural, pending: pending.map((work) => work.id), readiness } }) });
					record.work.push({
						id: `stall:${current.record.revision}:${digest}`,
						role: PlanningVocabulary.Role.Diagnose,
						stage: runtime.stage,
						scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
						prerequisiteIds: [],
						inputDigest: digest,
						assignment: `Resolve the remaining planning obligations with a distinct approach. Structural findings: ${canonicalJson({ value: structural })}. Readiness: ${canonicalJson({ value: readiness })}. Propose concrete repair or investigation work; do not certify completion.`,
						status: PlanningVocabulary.WorkState.Pending,
						attemptSequence: 0,
						failureIds: [],
						diagnosisIds: [],
					});
					return { record, artifacts: current.artifacts };
				},
			});
		}
	} else {
		outcome = await executeSelected({ runtime, snapshot, selected });
	}
	return outcome ?? { snapshot };
};

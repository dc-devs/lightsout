import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { applyLinkedPlanningEffects } from '#src/plan/workflow/applyPlanningResult/common/utils/applyLinkedPlanningEffects.ts';
import { completePlanningAttempt } from '#src/plan/workflow/applyPlanningResult/common/utils/completePlanningAttempt.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';
import { buildPlanningInvocationPacket } from '#src/plan/workflow/common/runtime/buildPlanningInvocationPacket.ts';
import { normalizePlanningProposal } from '#src/plan/workflow/common/runtime/normalizePlanningProposal.ts';
import { readPlanningInvocation } from '#src/plan/workflow/common/runtime/readPlanningInvocation.ts';
import { readPlanningObservations } from '#src/plan/workflow/common/runtime/readPlanningObservations.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { PlanningInvocationFailure } from '#src/plan/workflow/common/services/PlanningInvocationFailure.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { requirePlanningObservationContent } from '#src/plan/workflow/common/utils/transport/requirePlanningObservationContent.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';
import { fingerprintPlanningDependencies } from '#src/plan/workflow/evidence/index.ts';
import { validatePlanningRecord } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	result: PlanningRoleResult;
}

/** Apply only the current terminal proposal, revalidating paid work after unrelated CAS conflicts. */
export const applyPlanningResult = async ({
	runtime,
	result: proposed,
}: Params): Promise<{ accepted: boolean; snapshot: PlanningSnapshot; reason?: string }> => {
	const result = PlanningRoleResult.parse(proposed);
	if (result.kind !== PlanningVocabulary.ResultKind.Terminal) throw new Error('Evidence requests cannot complete planning work');
	let accepted = false;
	let reason: string | undefined;
	const snapshot = await updatePlanningSnapshot({
		runtime,
		propose: async (current) => {
			accepted = false;
			reason = undefined;
			const work = current.record.work.find((item) => item.id === result.workId);
			const invocation = readPlanningInvocation({ snapshot: current, workId: result.workId });
			if (
				!work ||
				work.status !== PlanningVocabulary.WorkState.Running ||
				work.currentAttemptId !== result.attemptId ||
				work.inputDigest !== result.inputDigest ||
				work.role !== result.role ||
				invocation?.attemptId !== result.attemptId ||
				invocation.id !== result.invocationId ||
				invocation.packetDigest !== result.packetDigest
			) {
				reason = 'The response does not belong to the latest active planning invocation';
				return undefined;
			}
			await runtime.lease.renew({ attemptId: result.attemptId });
			const standards = await resolvePlanningStandards({
				cwd: runtime.cwd,
				config: runtime.config,
				role: work.role,
				scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
			});
			const packet = await buildPlanningInvocationPacket({ runtime, snapshot: current, work, standards, observationPaths: invocation.observationPaths });
			if (
				result.dependencies.some(
					(dependency) => !invocation.dependencies.some((known) => canonicalJson({ value: known }) === canonicalJson({ value: dependency })),
				)
			)
				throw new PlanningInvocationFailure({ message: 'Role-reported dependencies must come from engine-acquired observations', externallyBlocked: false });
			const freshness = await fingerprintPlanningDependencies({
				cwd: runtime.cwd,
				record: current.record,
				standards,
				policy: planningEvidencePolicy({ exclude: [] }),
				dependencies: [...invocation.dependencies, ...result.dependencies],
			});
			if (packet.inputDigest !== invocation.packetDigest || !freshness.current) {
				reason = 'Planning inputs changed during the invocation';
				return undefined;
			}
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			try {
				const mapped = normalizePlanningProposal({ record, result });
				const observations = requirePlanningObservationContent({
					observations: readPlanningObservations({ snapshot: current, paths: invocation.observationPaths }),
				});
				const acceptance = { runtime, current, record, artifacts, result, mapped, work, invocation, standards, observations };
				await applyLinkedPlanningEffects(acceptance);
				await completePlanningAttempt(acceptance);
				const validation = validatePlanningRecord({ record });
				if (!validation.valid) throw new Error(`Invalid planning proposal: ${JSON.stringify(validation.issues)}`);
			} catch (error) {
				throw new PlanningInvocationFailure({ message: messageOf({ error }), externallyBlocked: false });
			}
			accepted = true;
			return { record, artifacts };
		},
	});
	return { accepted, snapshot, ...(reason ? { reason } : {}) };
};

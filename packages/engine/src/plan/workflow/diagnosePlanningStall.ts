import { type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { invokePlanningRole } from '#src/plan/workflow/invokePlanningRole.ts';
import { claimPlanningAttempt } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	failedWorkIds: string[];
}

/** Run a separately claimed diagnosis over preserved failures; diagnosis cannot grant readiness. */
export const diagnosePlanningStall = async ({ runtime, snapshot, failedWorkIds }: Params): Promise<PlanningRoleResult> => {
	const diagnosis = snapshot.record.work.find(
		(work) => work.role === PlanningVocabulary.Role.Diagnose && work.status !== PlanningVocabulary.WorkState.Complete,
	);
	if (!diagnosis || !failedWorkIds.every((id) => snapshot.record.work.some((work) => work.id === id)))
		throw new Error('Diagnosis requires existing failed work and its pending investigation');
	const claimed = await claimPlanningAttempt({ runtime, workId: diagnosis.id, expectedInputDigest: diagnosis.inputDigest });
	if (!claimed.claimed) throw new Error('Another owner holds the diagnostic attempt');
	const work = claimed.snapshot.record.work.find((item) => item.id === diagnosis.id);
	if (!work) throw new Error('Claimed diagnosis disappeared');
	return invokePlanningRole({ runtime, snapshot: claimed.snapshot, work });
};

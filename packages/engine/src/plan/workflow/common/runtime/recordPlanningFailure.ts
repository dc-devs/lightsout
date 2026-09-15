import { randomUUID } from 'node:crypto';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	runtime: PlanningRuntime;
	workId: string;
	attemptId: string;
	failure: string;
}

/** Preserve actual failures as resumable obstacles and schedule diagnosis without granting semantic verification. */
export const recordPlanningFailure = async ({ runtime, workId, attemptId, failure }: Params): Promise<PlanningSnapshot> => {
	const id = `failure:${randomUUID()}`;
	return updatePlanningSnapshot({
		runtime,
		propose: async (snapshot) => {
			const record = structuredClone(snapshot.record);
			const artifacts = new Map(snapshot.artifacts);
			const work = record.work.find((item) => item.id === workId);
			if (!work || work.currentAttemptId !== attemptId || work.status !== PlanningVocabulary.WorkState.Running) return undefined;
			const path = `planning-failures/${sha256({ content: id })}.json`;
			attachPlanningData({ record, artifacts, path, value: { workId, attemptId, failure } });
			const content = artifacts.get(path);
			if (content === undefined) throw new Error('Recorded diagnostic bytes are missing');
			record.findings.push({
				id,
				observationIds: [id],
				scope: work.scope,
				scenario: failure,
				consequence: 'This planning obligation remains incomplete.',
				missingObligation: work.assignment,
				severity: PlanningVocabulary.Severity.Blocking,
				owner: PlanningVocabulary.Owner.Planner,
				state: PlanningVocabulary.FindingState.Open,
				resolutionClaimIds: [],
				resolutionArtifacts: [],
				verificationReceiptIds: [],
				citations: [{ artifact: path, quote: attemptId, sha256: sha256({ content: content }) }],
			});
			work.status = PlanningVocabulary.WorkState.Interrupted;
			work.failureIds.push(id);
			const diagnosisPending = record.work.some(
				(item) => item.role === PlanningVocabulary.Role.Diagnose && item.status !== PlanningVocabulary.WorkState.Complete,
			);
			if (!diagnosisPending)
				record.work.push({
					id: `diagnose:${id}`,
					role: PlanningVocabulary.Role.Diagnose,
					stage: work.stage,
					scope: work.scope,
					prerequisiteIds: [],
					inputDigest: sha256({ content: `${work.inputDigest}:${failure}` }),
					assignment: `Diagnose ${workId}: ${failure}. Inspect prior failures; repeated identical failures need a distinct approach.`,
					status: PlanningVocabulary.WorkState.Pending,
					attemptSequence: 0,
					failureIds: [],
					diagnosisIds: [],
				});
			return { record, artifacts };
		},
	});
};

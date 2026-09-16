import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { validatePlanningProposalApprovals } from '#src/plan/workflow/common/answers/validatePlanningProposalApprovals.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningResultReceipt } from '#src/plan/workflow/store/common/types/PlanningResultReceipt.ts';
import { planningResultReceiptPath } from '#src/plan/workflow/store/common/utils/planningResultReceiptPath.ts';
import { readPlanningResultReceipts } from '#src/plan/workflow/store/common/validation/readPlanningResultReceipts.ts';
import { validateApprovedPlanningClaims } from '#src/plan/workflow/store/common/validation/validateApprovedPlanningClaims.ts';
import { validatePlanningHistory } from '#src/plan/workflow/store/common/validation/validatePlanningHistory.ts';

interface Params {
	previous?: PlanningSnapshot;
	record: PlanningRecord;
	artifacts: ReadonlyMap<string, string>;
}

/** A delayed result cannot complete a replaced attempt, and established historical authority cannot be rewritten. */
export const validatePlanningTransition = ({ previous, record, artifacts }: Params): void => {
	validatePlanningProposalApprovals({ snapshot: { record, artifacts, digest: '' }, previous });
	const before = previous?.record;
	if (before !== undefined) {
		validatePlanningHistory({ previous: before, record });
		validateApprovedPlanningClaims({ previous: before, record });
		for (const phase of before.artifacts.filter((artifact) => artifact.phaseId !== undefined))
			if (!record.artifacts.some((artifact) => artifact.phaseId === phase.phaseId))
				throw new Error(`An established phase identity cannot disappear: ${phase.phaseId}`);
	}

	const accepted = new Set<string>();
	for (const work of record.work) {
		if (work.status !== PlanningVocabulary.WorkState.Complete) continue;
		const prior = before?.work.find((item) => item.id === work.id);
		if (prior?.status === PlanningVocabulary.WorkState.Complete && canonicalJson({ value: prior }) === canonicalJson({ value: work })) continue;
		if (
			prior?.status !== PlanningVocabulary.WorkState.Running ||
			prior.currentAttemptId !== work.currentAttemptId ||
			prior.role !== work.role ||
			prior.stage !== work.stage ||
			prior.inputDigest !== work.inputDigest ||
			prior.attemptSequence !== work.attemptSequence
		)
			throw new Error('Only the current running attempt may publish its completion');
		const text = artifacts.get(planningResultReceiptPath({ id: work.resultReceiptId ?? '' }));
		if (text === undefined) throw new Error('Completion is missing its result receipt');
		const receipt = PlanningResultReceipt.parse(JSON.parse(text));
		accepted.add(receipt.id);
		if (receipt.effects.artifacts.some((effect) => !record.artifacts.some((item) => item.path === effect.path && item.sha256 === effect.sha256)))
			throw new Error('Accepted result artifact effects do not match their committed bytes');
		if (receipt.acceptedFromDigest !== previous?.digest || receipt.acceptedRevision !== record.revision)
			throw new Error('Result receipt does not bind the accepted generation transition');
	}
	const results = readPlanningResultReceipts({ record, artifacts });
	for (const result of results.values()) {
		const path = planningResultReceiptPath({ id: result.id });
		const existed = before?.artifacts.some((artifact) => artifact.path === path) ?? false;
		if (!existed && !accepted.has(result.id)) throw new Error('New accepted results must belong to a current completion');
	}
	for (const review of record.reviewReceipts) {
		if (before?.reviewReceipts.some((item) => item.id === review.id)) continue;
		const result = [...results.values()].find(
			(item) =>
				item.effects.reviewReceiptIds.includes(review.id) &&
				item.workId === review.workId &&
				item.attemptId === review.attemptId &&
				item.role === review.role &&
				item.inputDigest === review.inputDigest,
		);
		if (result === undefined || !accepted.has(result.id)) throw new Error('New independent reviews must be accepted with their reviewing completion');
	}
};

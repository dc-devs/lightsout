import { type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningServices } from '#src/plan/workflow/common/types/PlanningServices.ts';

interface Params {
	record: PlanningRecord;
	invalidation: ReturnType<PlanningServices['invalidate']>;
	authorWorkId?: string;
}

/** Retire only identified current authority and reopen stale settlements in the same canonical transaction. */
export const applyPlanningInvalidation = ({ record, invalidation, authorWorkId }: Params): void => {
	const ids = new Set([
		...invalidation.workIds,
		...record.reviewReceipts
			.filter(
				(receipt) =>
					invalidation.receiptIds.includes(receipt.id) && record.work.some((work) => work.id === receipt.workId && work.currentAttemptId === receipt.attemptId),
			)
			.map((receipt) => receipt.workId),
	]);
	if (authorWorkId && ids.has(authorWorkId)) throw new Error('An acceptance policy cannot invalidate its own just-accepted authoring operation');
	for (const id of ids) {
		const work = record.work.find((work) => work.id === id);
		if (!work) throw new Error('Invalidation references unknown work');
		if (
			work.status === PlanningVocabulary.WorkState.Complete &&
			(work.role === PlanningVocabulary.Role.Diagnose || work.role === PlanningVocabulary.Role.Adjudicate)
		)
			continue;
		work.status = PlanningVocabulary.WorkState.Pending;
		work.currentAttemptId = undefined;
		work.resultReceiptId = undefined;
	}
	for (const id of invalidation.reopenFindingIds ?? []) {
		const finding = record.findings.find((finding) => finding.id === id);
		if (!finding) throw new Error('Settlement invalidation references an unknown finding');
		if (finding.state === PlanningVocabulary.FindingState.Verified) finding.state = PlanningVocabulary.FindingState.Repairing;
		else if (finding.state === PlanningVocabulary.FindingState.Withdrawn) finding.state = PlanningVocabulary.FindingState.Open;
	}
	for (const work of invalidation.work ?? []) {
		if (record.work.some((existing) => existing.id === work.id) || work.status !== PlanningVocabulary.WorkState.Pending || work.attemptSequence !== 0)
			throw new Error('Invalidation work must be a new unstarted obligation');
		record.work.push(work);
	}
};

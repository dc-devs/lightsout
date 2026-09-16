import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { DecisionsRecord, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { validatePlanningProposalApprovals } from '#src/plan/workflow/common/answers/validatePlanningProposalApprovals.ts';
import { readPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/readPlanningExecutionPolicy.ts';
import { readPlanningResultReceipts } from '#src/plan/workflow/store/common/validation/readPlanningResultReceipts.ts';

interface Params {
	record: PlanningRecord;
	artifacts: ReadonlyMap<string, string>;
}

/** Hashes protect bytes; these bindings protect the meaning of engine-owned historical and result receipts. */
export const validatePlanningArtifactBodies = ({ record, artifacts }: Params): void => {
	validatePlanningProposalApprovals({ snapshot: { record, artifacts, digest: '' } });
	for (const stage of Object.values(PlanningVocabulary.Stage)) readPlanningExecutionPolicy({ snapshot: { record, artifacts, digest: '' }, stage });
	for (const legacy of record.legacySettlements ?? []) {
		const text = artifacts.get(legacy.artifact);
		if (text === undefined || sha256({ content: text }) !== legacy.artifactDigest) throw new Error('Historical source bytes are missing or changed');
		const parsed: unknown = JSON.parse(text);
		const source = DecisionsRecord.parse(parsed);
		const raw = z.object({ decisions: z.array(z.unknown()).optional() }).parse(parsed);
		if (
			source.planName !== record.planName ||
			raw.decisions?.[legacy.rowIndex] === undefined ||
			canonicalJson({ value: raw.decisions[legacy.rowIndex] }) !== legacy.rowText
		)
			throw new Error('Historical receipt does not identify the original source row');
	}
	const results = readPlanningResultReceipts({ record, artifacts });
	for (const work of record.work) {
		if (work.resultReceiptId === undefined) continue;
		const receipt = results.get(work.resultReceiptId);
		if (receipt === undefined) throw new Error(`Missing accepted planning result: ${work.id}`);
		if (
			receipt.id !== work.resultReceiptId ||
			receipt.workId !== work.id ||
			receipt.role !== work.role ||
			receipt.attemptId !== work.currentAttemptId ||
			receipt.inputDigest !== work.inputDigest ||
			receipt.acceptedRevision > record.revision ||
			work.status !== PlanningVocabulary.WorkState.Complete
		)
			throw new Error('Accepted planning result is not bound to the current completed attempt');
	}
	for (const review of record.reviewReceipts) {
		const accepted = [...results.values()].some(
			(result) =>
				result.workId === review.workId &&
				result.attemptId === review.attemptId &&
				result.role === review.role &&
				result.inputDigest === review.inputDigest &&
				result.effects.reviewReceiptIds.includes(review.id),
		);
		if (!accepted) throw new Error('Independent review requires its accepted reviewing attempt');
	}
};

import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { PlanningRecord } from '#src/contracts/index.ts';
import { PlanningResultReceipt } from '#src/plan/workflow/store/common/types/PlanningResultReceipt.ts';
import { planningResultReceiptPath } from '#src/plan/workflow/store/common/utils/planningResultReceiptPath.ts';

interface Params {
	record: PlanningRecord;
	artifacts: ReadonlyMap<string, string>;
}

/** Accepted result history remains address-bound and referentially intact after work is invalidated. */
export const readPlanningResultReceipts = ({ record, artifacts }: Params): Map<string, PlanningResultReceipt> => {
	const receipts = new Map<string, PlanningResultReceipt>();
	for (const descriptor of record.artifacts.filter((item) => item.path.startsWith('planning-results/'))) {
		const text = artifacts.get(descriptor.path);
		if (text === undefined) throw new Error('Accepted planning result bytes are missing');
		const receipt = PlanningResultReceipt.parse(JSON.parse(text));
		if (planningResultReceiptPath({ id: receipt.id }) !== descriptor.path || canonicalJson({ value: receipt }) !== text)
			throw new Error('Accepted planning result has an invalid canonical identity');
		if (receipt.acceptedRevision < 1 || receipt.acceptedRevision > record.revision)
			throw new Error('Accepted planning result has an invalid acceptance revision');
		const effects = receipt.effects;
		const referenced = [
			...effects.claimIds.filter((id) => !record.claims.some((item) => item.id === id)),
			...effects.evidenceIds.filter((id) => !record.evidence.some((item) => item.id === id)),
			...effects.findingIds.filter((id) => !record.findings.some((item) => item.id === id)),
			...effects.reviewReceiptIds.filter((id) => !record.reviewReceipts.some((item) => item.id === id)),
		];
		if (referenced.length > 0) throw new Error('Accepted planning result refers to missing effects');
		receipts.set(receipt.id, receipt);
	}
	return receipts;
};

import { PlanningSettlement } from '#src/plan/workflow/common/types/PlanningSettlement.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningSavedAdjudicationRequest } from '#src/plan/workflow/common/types/questions/PlanningSavedAdjudicationRequest.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Never discard captured bytes that are themselves the authority for a finding or its resolution. */
export const validatePlanningPortableCitations = ({ snapshot }: Params): void => {
	const citations = [
		...snapshot.record.findings.flatMap((finding) => finding.citations),
		...snapshot.record.reviewReceipts.flatMap((receipt) => receipt.verifiedFindings.flatMap((finding) => finding.citations)),
	];
	for (const descriptor of snapshot.record.artifacts.filter((item) => item.path.startsWith('planning-settlements/'))) {
		const settlement = readPlanningProof({ snapshot, path: descriptor.path, schema: PlanningSettlement });
		if (!settlement) throw new Error('Portable settlement proof is missing or corrupt');
		citations.push(...settlement.citations);
	}
	for (const descriptor of snapshot.record.artifacts.filter((item) => item.path.startsWith('planning-adjudication-requests/'))) {
		const dispute = readPlanningProof({ snapshot, path: descriptor.path, schema: PlanningSavedAdjudicationRequest });
		if (!dispute) throw new Error('Portable adjudication request is missing or corrupt');
		citations.push(...dispute.request.citations);
	}
	for (const citation of citations)
		if (snapshot.omittedObservations?.some((item) => item.path === citation.artifact))
			throw new Error(
				`Publication would omit required citation authority: ${citation.artifact}; cite the original source with its observed dependency before publishing`,
			);
};

import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Approval binds the complete design and delegated choices, excluding later unrelated confirmation bookkeeping. */
export const planningAlignmentBasis = ({ snapshot }: Params): { sourceDigest: string; semanticDigest: string } => {
	const record = snapshot.record;
	const sourceDigest = sha256({ content: canonicalJson({ value: record.sources.map(({ text: _text, ...source }) => source) }) });
	const claims = record.claims.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded);
	const confirmationIds = new Set(claims.flatMap((claim) => (claim.confirmationId ? [claim.confirmationId] : [])));
	const semanticDigest = sha256({
		content: canonicalJson({
			value: {
				sourceDigest,
				claims,
				standards: record.standards,
				delegation: record.confirmations
					.filter((confirmation) => confirmationIds.has(confirmation.id))
					.map(({ alignment: _alignment, ...confirmation }) => confirmation),
			},
		}),
	});
	return { sourceDigest, semanticDigest };
};

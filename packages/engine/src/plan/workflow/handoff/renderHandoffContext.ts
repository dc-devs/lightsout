import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { PlanningContract } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	contract: PlanningContract;
}
/** Original wording travels once, with references from claims rather than duplicated interview text. */
export const renderHandoffContext = ({ snapshot, contract }: Params): string => {
	if (snapshot.digest !== contract.generation) throw new Error('Handoff context crossed planning generations');
	const claims = contract.claims.map((claim) => {
		const { text: _text, ...origin } = claim.origin;
		return { ...claim, origin };
	});
	const value = {
		generation: contract.generation,
		phaseId: contract.phaseId,
		originals: snapshot.record.sources,
		claims,
		historicalSettlements: snapshot.record.legacySettlements ?? [],
		standards: contract.standards,
		interfaces: contract.interfaces,
		invariants: contract.invariants,
		allowedRoots: contract.allowedRoots,
		privateFreedom: contract.privateFreedom,
	};
	return `\n## Binding implementation contract\n\nOriginals retain the captured wording; claim origins refer to them by digest and locator. Preserve the binding behavior and exact acceptance obligations.\n\n${canonicalJson({ value })}\n`;
};

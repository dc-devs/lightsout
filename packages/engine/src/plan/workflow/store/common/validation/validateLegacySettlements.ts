import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { DecisionRow, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { legacyPlanningScope } from '#src/plan/workflow/store/common/migration/legacyPlanningScope.ts';
import type { PlanningGraphIssue } from '#src/plan/workflow/store/common/types/PlanningGraphIssue.ts';

interface Params {
	record: PlanningRecord;
	issues: PlanningGraphIssue[];
}

/** Historical authority is immovable and validates the legacy row's actual settlement semantics. */
export const validateLegacySettlements = ({ record, issues }: Params): void => {
	const settlements = new Map((record.legacySettlements ?? []).map((item) => [item.id, item]));
	for (const claim of record.claims) {
		if (claim.legacySettlementId === undefined) continue;
		const receipt = settlements.get(claim.legacySettlementId);
		const at = `claims.${claim.id}.legacySettlementId`;
		if (receipt === undefined) {
			issues.push({ at, message: 'Unknown historical settlement' });
			continue;
		}
		let row: DecisionRow | undefined;
		try {
			row = DecisionRow.parse(JSON.parse(receipt.rowText));
		} catch {
			issues.push({ at, message: 'Historical settlement has an invalid original decision row' });
		}
		const artifact = record.artifacts.find((item) => item.path === receipt.artifact);
		const valid =
			receipt.planName === record.planName &&
			receipt.claimId === claim.id &&
			artifact?.sha256 === receipt.artifactDigest &&
			sha256({ content: receipt.rowText }) === receipt.rowDigest &&
			row !== undefined &&
			!row.assumption &&
			row.choice === claim.text &&
			sha256({ content: claim.text }) === receipt.choiceDigest &&
			claim.kind === PlanningVocabulary.ClaimKind.Decision &&
			claim.owner === PlanningVocabulary.Owner.User &&
			claim.origin.artifact === receipt.sourcePath &&
			claim.origin.locator === `decisions[${receipt.rowIndex}]` &&
			claim.origin.text === receipt.rowText &&
			canonicalJson({ value: receipt.phaseBindings.map((binding) => binding.name) }) === canonicalJson({ value: row?.phases ?? [] }) &&
			claim.origin.sha256 === receipt.rowDigest &&
			claim.state !== PlanningVocabulary.ClaimState.Unresolved &&
			canonicalJson({ value: receipt.scope }) === canonicalJson({ value: legacyPlanningScope({ bindings: receipt.phaseBindings }) }) &&
			canonicalJson({ value: claim.scope }) === canonicalJson({ value: receipt.scope });
		if (!valid) issues.push({ at, message: 'Historical settlement cannot be copied, broadened or rebound to changed content' });
	}
	for (const receipt of settlements.values()) {
		if (!record.claims.some((claim) => claim.id === receipt.claimId && claim.legacySettlementId === receipt.id))
			issues.push({ at: receipt.id, message: 'Historical settlement is not bound to its original claim' });
	}
};

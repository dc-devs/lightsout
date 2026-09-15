import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningDependency, type PlanningRecord, PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningScopesIntersect } from '#src/plan/workflow/common/utils/planningScopesIntersect.ts';
import { selectPlanningArtifacts } from '#src/plan/workflow/common/utils/selectPlanningArtifacts.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';

interface Params {
	record: PlanningRecord;
	dependency: Extract<PlanningDependency, { kind: typeof PlanningVocabulary.Dependency.Collection }>;
}

/** Recompute membership using the persisted selector, so new relevant members invalidate prior conclusions. */
export const planningCollectionDigests = ({ record, dependency }: Params): Record<string, string> => {
	const scope = PlanningScope.parse(JSON.parse(dependency.scope));
	const selected = ({ candidate }: { candidate: PlanningScope }) => planningScopesIntersect({ left: scope, right: candidate });
	const selectedClaims = selectPlanningClaims({ record, work: { scope } });
	const artifacts = selectPlanningArtifacts({ record, scope, claimIds: selectedClaims.map((claim) => claim.id) });
	let members: Array<{ id: string; value: unknown }>;
	switch (dependency.collection) {
		case PlanningVocabulary.Collection.Claims:
			members = selectedClaims.map((claim) => ({ id: claim.id, value: claim }));
			break;
		case PlanningVocabulary.Collection.Phases:
			members = artifacts
				.filter((artifact) => artifact.variant === PlanningVocabulary.Artifact.Phase)
				.map((artifact) => ({ id: artifact.phaseId ?? artifact.path, value: artifact }));
			break;
		case PlanningVocabulary.Collection.Exports:
			members = artifacts.flatMap((artifact) => artifact.exports.map((name) => ({ id: `${artifact.path}:${name}`, value: { path: artifact.path, name } })));
			break;
		case PlanningVocabulary.Collection.Reviews:
			members = record.reviewReceipts
				.filter((receipt) => {
					const owner = record.work.find((work) => work.id === receipt.workId);
					return owner === undefined || selected({ candidate: owner.scope });
				})
				.map((receipt) => ({ id: receipt.id, value: receipt }));
	}
	return Object.fromEntries(members.sort((a, b) => a.id.localeCompare(b.id)).map(({ id, value }) => [id, sha256({ content: canonicalJson({ value }) })]));
};

import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningContract, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readCommittedPlanningStandards } from '#src/plan/workflow/common/utils/readCommittedPlanningStandards.ts';
import { selectPlanningArtifacts } from '#src/plan/workflow/common/utils/selectPlanningArtifacts.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';

interface Params {
	snapshot: PlanningSnapshot;
	phaseId?: string;
}

/** Resolve original obligations and exact standards from one generation without consulting mutable views or configuration. */
export const renderPlanningContract = ({ snapshot, phaseId }: Params): PlanningContract => {
	const { record } = snapshot;
	for (const source of record.sources)
		if (!record.claims.some((claim) => canonicalJson({ value: claim.origin }) === canonicalJson({ value: source })))
			throw new Error(`Original planning source requires obligation classification: ${source.artifact} at ${source.locator}`);
	const phase = phaseId === undefined ? undefined : record.artifacts.find((artifact) => artifact.phaseId === phaseId);
	if (phaseId !== undefined && phase === undefined) throw new Error(`Missing planning phase: ${phaseId}`);
	const scope: PlanningScope =
		phaseId !== undefined && phase
			? { kind: PlanningVocabulary.Scope.Selected, claimIds: phase.claimIds, phaseIds: [phaseId], packageRoots: [] }
			: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
	const claims = selectPlanningClaims({ record, work: { scope } });
	const ids = new Set(claims.map((claim) => claim.id));
	const selected = selectPlanningArtifacts({ record, scope, claimIds: [...ids] }).filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data);
	for (const claim of claims) {
		const originalPath = `planning-originals/${claim.origin.sha256}.txt`;
		const original = record.artifacts.find((artifact) => artifact.path === originalPath);
		if (!original || original.sha256 !== claim.origin.sha256 || snapshot.artifacts.get(originalPath) !== claim.origin.text)
			throw new Error(`Missing captured original bytes for planning claim ${claim.id}`);
		if (
			sha256({ content: claim.origin.text }) !== claim.origin.sha256 ||
			!record.sources.some((source) => canonicalJson({ value: source }) === canonicalJson({ value: claim.origin }))
		)
			throw new Error(`Missing or changed original source for planning claim ${claim.id}`);
	}
	for (const artifact of selected) {
		const content = snapshot.artifacts.get(artifact.path);
		if (content === undefined || sha256({ content }) !== artifact.sha256) throw new Error(`Missing or changed planning artifact: ${artifact.path}`);
		for (const id of artifact.claimIds) if (!record.claims.some((claim) => claim.id === id)) throw new Error(`Missing artifact claim: ${id}`);
	}
	const bundle = readCommittedPlanningStandards({ snapshot });
	const standards = bundle.channels.map((channel) => {
		const descriptor = record.standards.find((standard) => standard.channel === channel.channel);
		if (!descriptor) throw new Error(`Missing committed standards identity: ${channel.channel}`);
		return { descriptor, text: channel.text };
	});
	const contracts = claims
		.filter((claim) => claim.kind === PlanningVocabulary.ClaimKind.Contract)
		.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded);
	return PlanningContract.parse({
		format: 'lightsout-planning-v1',
		generation: snapshot.digest,
		...(phaseId === undefined ? {} : { phaseId }),
		claims,
		interfaces: [...new Set(contracts.flatMap((claim) => claim.contract.signatures))],
		invariants: [...new Set(contracts.flatMap((claim) => [...claim.contract.ordering, ...claim.contract.failures, ...claim.contract.boundaries]))],
		standards,
		acceptance: claims.filter((claim) => claim.kind === PlanningVocabulary.ClaimKind.Acceptance && claim.state !== PlanningVocabulary.ClaimState.Superseded),
		allowedRoots: [...new Set((phase ? [phase] : selected).flatMap((artifact) => artifact.boundaries.packageRoots))],
		privateFreedom:
			'Choose and organize private helpers within the approved roots and actual file limits. Preserve original intent, public and shared signatures, architecture boundaries, failure and ordering invariants, exact acceptance tests, and all recorded standards. Changing a binding obligation requires explicit reconciliation and renewed readiness.',
		// Only the implementation boundary can supply verified predecessor source receipts.
		predecessorReceiptIds: [],
		artifacts: selected,
	});
};

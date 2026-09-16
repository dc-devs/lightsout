import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningClaim, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

const renderClaim = ({ claim }: { claim: PlanningClaim }) => {
	const detail: string[] = [];
	if (claim.kind === PlanningVocabulary.ClaimKind.Contract)
		for (const [label, entries] of Object.entries(claim.contract)) detail.push(`${label}:\n${entries.map((entry) => `- ${entry}`).join('\n') || 'None.'}`);
	if (claim.kind === PlanningVocabulary.ClaimKind.Acceptance) for (const [label, value] of Object.entries(claim.acceptance)) detail.push(`${label}: ${value}`);
	if (claim.kind === PlanningVocabulary.ClaimKind.Question) detail.push(canonicalJson({ value: claim.question }));
	return [
		`### ${claim.id} — ${claim.kind}\n\n${claim.text}\n\n${claim.explanation}`,
		`Owner: ${claim.owner}; state: ${claim.state}; dependencies: ${claim.dependencies.join(', ') || 'None'}.`,
		`Scope: ${canonicalJson({ value: claim.scope })}`,
		...detail,
	].join('\n\n');
};

/** Show every binding structured behavior and phase boundary before asking the user to approve it. */
export const renderPlanningDesignProposal = ({ snapshot }: Params): string => {
	const claims = snapshot.record.claims.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded);
	const confirmations = new Set(claims.flatMap((claim) => (claim.confirmationId ? [claim.confirmationId] : [])));
	const layouts = snapshot.record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data);
	return [
		...claims.map((claim) => renderClaim({ claim })),
		'## Phase boundaries',
		...layouts.map(({ sha256: _contentDigest, ...layout }) => canonicalJson({ value: layout })),
		'## Approved decisions and delegated freedom',
		...snapshot.record.confirmations
			.filter((confirmation) => confirmations.has(confirmation.id))
			.map(({ alignment: _alignment, ...confirmation }) => canonicalJson({ value: confirmation })),
		'## Standards',
		...snapshot.record.standards.map((standard) => canonicalJson({ value: standard })),
	].join('\n\n');
};

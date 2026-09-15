import { basename } from 'node:path';
import { FindingSeverity, type PlanningClaim, PlanningVocabulary, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { encodeMarkdownTableCell } from '#src/plan/common/rewriting/encodeMarkdownTableCell.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	artifacts: ReadonlyMap<string, string>;
}

/** Require exact acceptance mappings and dependency ancestry for each binding obligation, beyond a nonempty summary table. */
export const validatePlanningCoverage = ({ snapshot, artifacts }: Params): StructuralFinding[] => {
	const record = snapshot.record;
	const findings: StructuralFinding[] = [];
	const active = record.claims.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded);
	const claims = new Map(record.claims.map((claim) => [claim.id, claim]));
	const covered = new Set<string>();
	const report = ({ claim, issue, phase = 'overview.md' }: { claim: PlanningClaim; issue: string; phase?: string }) =>
		findings.push({
			check: StructuralCheck.LedgerCovers,
			severity: FindingSeverity.Blocking,
			phase,
			issue: `${claim.id}: ${issue}`,
			location: `${phase} → Acceptance Tests`,
			fix: 'Preserve the original obligation, link an exact acceptance claim to its dependency ancestry, and render it in the responsible artifact.',
		});
	for (const claim of active) {
		if (claim.kind !== PlanningVocabulary.ClaimKind.Acceptance) continue;
		const owners = record.artifacts.filter(
			(artifact) =>
				artifact.variant !== PlanningVocabulary.Artifact.Data &&
				artifact.variant !== PlanningVocabulary.Artifact.Overview &&
				(artifact.variant === PlanningVocabulary.Artifact.Single ||
					artifact.claimIds.includes(claim.id) ||
					(artifact.phaseId !== undefined && claim.scope.phaseIds.includes(artifact.phaseId))),
		);
		if (owners.length === 0) report({ claim, issue: 'Acceptance mapping has no responsible implementation artifact' });
		let valid = owners.length > 0;
		for (const owner of owners) {
			const content = artifacts.get(owner.path);
			const parsed = parsePlan({ content: content ?? '', base: basename(owner.path) });
			const acceptance = claim.acceptance;
			const found =
				acceptance.kind === PlanningVocabulary.Acceptance.Test
					? parsed.ledger.some(
							(row) =>
								row.criterion === acceptance.criterion &&
								row.testFile === acceptance.testFile &&
								row.testName === acceptance.testName &&
								row.gate === acceptance.gate,
						)
					: parsed.proseFiles.some(
							(file) =>
								file.path === acceptance.path &&
								file.reason ===
									`${encodeMarkdownTableCell({ text: acceptance.reason })} Verification: ${encodeMarkdownTableCell({ text: acceptance.verification })}`,
						);
			if (!found) {
				valid = false;
				report({ claim, phase: owner.path, issue: 'Exact canonical acceptance behavior or prose justification is missing from its implementation view' });
			}
		}
		if (valid) {
			const queue = [claim.id];
			while (queue.length > 0) {
				const id = queue.pop();
				if (id === undefined || covered.has(id)) continue;
				covered.add(id);
				queue.push(...(claims.get(id)?.dependencies ?? []));
			}
		}
	}
	for (const claim of active)
		if (claim.kind !== PlanningVocabulary.ClaimKind.Acceptance && claim.kind !== PlanningVocabulary.ClaimKind.Question && !covered.has(claim.id))
			report({ claim, issue: 'Binding source obligation lacks a test or explicitly justified prose verification mapping' });
	for (const source of record.sources)
		if (
			!record.claims.some(
				(claim) => claim.origin.artifact === source.artifact && claim.origin.locator === source.locator && claim.origin.sha256 === source.sha256,
			)
		)
			findings.push({
				check: StructuralCheck.LedgerCovers,
				severity: FindingSeverity.Blocking,
				phase: 'overview.md',
				issue: `Unclassified original source: ${source.artifact} at ${source.locator}`,
				location: source.artifact,
				fix: 'Inventory the full original source; do not replace its obligations with a summary.',
			});
	return findings;
};

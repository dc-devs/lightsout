import { basename } from 'node:path';
import { type PlanningArtifact, type PlanningClaim, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { encodeMarkdownTableCell } from '#src/plan/common/rewriting/encodeMarkdownTableCell.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { getPlanTouchedPaths } from '#src/plan/common/utils/getPlanTouchedPaths.ts';
import { decisionLogReference, renderDecisionLog } from '#src/plan/decisionLog/index.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { renderGlobalConstraints, renderPhaseSections } from '#src/plan/sections/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { orderPlanningPhases } from '#src/plan/workflow/common/utils/orderPlanningPhases.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';
import { planningDecisionRecord } from '#src/plan/workflow/draft/common/utils/planningDecisionRecord.ts';

interface Params {
	snapshot: PlanningSnapshot;
	artifacts: ReadonlyMap<string, string>;
}

const declarationFor = ({
	artifact,
	index,
	artifacts,
}: {
	artifact: PlanningArtifact;
	index: number;
	artifacts: ReadonlyMap<string, string>;
}): PhaseDeclaration => {
	const content = artifacts.get(artifact.path);
	if (content === undefined) throw new Error(`Missing phase bytes for declaration: ${artifact.path}`);
	const plan = parsePlan({ content, base: basename(artifact.path) });
	const counts = getPlanTouchedPaths({ plan });
	return {
		number: index + 1,
		file: basename(artifact.path),
		scope: artifact.scopeText ?? artifact.path,
		createdCount: counts.created.length,
		touchedCount: counts.touched.length,
		creates: plan.createPaths,
		exports: artifact.exports,
		scripts: artifact.declaredScripts ?? [],
		...(plan.fileBudget === undefined ? {} : { fileBudget: plan.fileBudget }),
	};
};

const ledgerSections = ({ claims }: { claims: PlanningClaim[] }): Map<string, string> => {
	const tests: string[] = [];
	const prose: string[] = [];
	for (const claim of claims) {
		if (claim.kind !== PlanningVocabulary.ClaimKind.Acceptance || claim.state === PlanningVocabulary.ClaimState.Superseded) continue;
		if (claim.acceptance.kind === PlanningVocabulary.Acceptance.Test) {
			const { criterion, testFile, testName, gate } = claim.acceptance;
			const cells = [
				encodeMarkdownTableCell({ text: criterion }),
				`\`${encodeMarkdownTableCell({ text: testFile })}\``,
				encodeMarkdownTableCell({ text: testName }),
				encodeMarkdownTableCell({ text: gate }),
			];
			tests.push(`| ${cells.join(' | ')} |`);
		} else {
			prose.push(
				`- \`${claim.acceptance.path}\` — ${encodeMarkdownTableCell({ text: claim.acceptance.reason })} Verification: ${encodeMarkdownTableCell({ text: claim.acceptance.verification })}`,
			);
		}
	}
	return new Map([
		['Acceptance Tests', `## Acceptance Tests\n\n| Criterion | Test file | Test name | Gate |\n|---|---|---|---|\n${tests.join('\n')}`],
		['Prose Files', `## Prose Files\n\n${prose.length ? prose.join('\n') : 'None.'}`],
	]);
};

const provenanceSection = ({ snapshot, artifact, claims }: { snapshot: PlanningSnapshot; artifact: PlanningArtifact; claims: PlanningClaim[] }) => {
	const sources = new Set(claims.map((claim) => claim.origin.sha256));
	const rows = [
		...snapshot.record.sources
			.filter((source) => sources.has(source.sha256))
			.map((source) => `- Source ${source.sha256}: ${source.artifact} @ ${source.locator}`),
		...claims.map(
			(claim) =>
				`- Claim ${claim.id}${claim.confirmationId ? `; confirmation ${claim.confirmationId}` : ''}${claim.legacySettlementId ? `; historical settlement ${claim.legacySettlementId}` : ''}`,
		),
		...snapshot.record.standards.map((standard) => `- Standards ${standard.channel}: ${standard.sha256}`),
		...(artifact.phaseId ? [`- Stable phase identity: ${artifact.phaseId}`] : []),
	];
	return `## Planning Provenance\n\n${rows.join('\n')}`;
};

/** Build linked views from canonical meanings without embedding a generation or self-referential artifact hash. */
export const planningGeneratedSections = ({ snapshot, artifacts }: Params): Map<string, Map<string, string>> => {
	const deliverables = snapshot.record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data);
	const phases = orderPlanningPhases({ record: snapshot.record });
	const decisions = planningDecisionRecord({ snapshot });
	const result = new Map<string, Map<string, string>>();
	for (const artifact of deliverables) {
		if (artifact.variant === PlanningVocabulary.Artifact.Phase && !artifact.phaseId) throw new Error(`Phase identity is missing: ${artifact.path}`);
		const scope: PlanningScope = artifact.phaseId
			? { kind: PlanningVocabulary.Scope.Selected, phaseIds: [artifact.phaseId], claimIds: artifact.claimIds, packageRoots: [] }
			: { kind: PlanningVocabulary.Scope.WholePlan, phaseIds: [], claimIds: [], packageRoots: [] };
		const claims = selectPlanningClaims({ record: snapshot.record, work: { scope } });
		const scoped = planningDecisionRecord({ snapshot: { ...snapshot, record: { ...snapshot.record, claims } } });
		const sections = new Map([
			['Decision Log', artifact.variant === PlanningVocabulary.Artifact.Phase ? decisionLogReference() : renderDecisionLog({ decisions: decisions.decisions })],
			['Global Constraints', renderGlobalConstraints({ decisions: scoped.decisions })],
			['Planning Provenance', provenanceSection({ snapshot, artifact, claims })],
		]);
		if (artifact.variant === PlanningVocabulary.Artifact.Overview) {
			const existing = parsePhaseDeclarations({ plan: parsePlan({ content: snapshot.artifacts.get(artifact.path) ?? '', base: basename(artifact.path) }) });
			const declarations = phases.map((phase, index) => {
				const prior = existing.find((item) => item.file === basename(phase.path));
				return declarationFor({
					artifact: { ...phase, scopeText: phase.scopeText ?? prior?.scope, declaredScripts: phase.declaredScripts ?? prior?.scripts },
					index,
					artifacts,
				});
			});
			for (const [heading, section] of renderPhaseSections({ declarations, lossless: true })) sections.set(heading, section);
		} else {
			const owned = claims.filter(
				(claim) =>
					artifact.variant === PlanningVocabulary.Artifact.Single ||
					artifact.claimIds.includes(claim.id) ||
					(artifact.phaseId !== undefined && claim.scope.phaseIds.includes(artifact.phaseId)),
			);
			for (const [heading, section] of ledgerSections({ claims: owned })) sections.set(heading, section);
		}
		result.set(artifact.path, sections);
	}
	return result;
};

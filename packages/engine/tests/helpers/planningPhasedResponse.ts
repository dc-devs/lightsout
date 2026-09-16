import { type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/index.ts';

interface Params {
	response: PlanningRoleResult;
	snapshot: PlanningSnapshot;
}

/** Controlled authoring of two separately owned acceptance obligations through the real planning protocol. */
export const planningPhasedResponse = ({ response, snapshot }: Params): PlanningRoleResult => {
	if (response.kind !== PlanningVocabulary.ResultKind.Terminal) return response;
	if (response.role === PlanningVocabulary.Role.Architect) {
		const acceptance = response.claims.find((claim) => claim.id === 'retry-acceptance');
		if (acceptance?.kind !== PlanningVocabulary.ClaimKind.Acceptance || acceptance.acceptance.kind !== PlanningVocabulary.Acceptance.Test)
			throw new Error('Expected retry acceptance authoring');
		const scope = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: ['A'], packageRoots: [] };
		return {
			...response,
			claims: [
				...response.claims.filter((claim) => claim.id !== acceptance.id),
				{ ...acceptance, scope },
				{
					...acceptance,
					id: 'report-acceptance',
					text: 'Report retained retry completion.',
					scope: { ...scope, phaseIds: ['B'] },
					acceptance: { ...acceptance.acceptance, testFile: 'src/retryReport.unit.test.ts', testName: 'reports retained retry completion' },
				},
			],
			artifactLayouts: [
				{
					path: 'overview.md',
					variant: PlanningVocabulary.Artifact.Overview,
					claimIds: [],
					prerequisiteIds: [],
					exports: [],
					boundaries: scope,
					baseDescriptorDigest: null,
				},
				{
					path: 'phase1-retry.md',
					variant: PlanningVocabulary.Artifact.Phase,
					phaseId: 'A',
					claimIds: ['retry-acceptance'],
					prerequisiteIds: [],
					exports: [],
					boundaries: scope,
					baseDescriptorDigest: null,
				},
				{
					path: 'phase2-report.md',
					variant: PlanningVocabulary.Artifact.Phase,
					phaseId: 'B',
					claimIds: ['report-acceptance'],
					prerequisiteIds: ['A'],
					exports: [],
					boundaries: { ...scope, phaseIds: ['B'] },
					baseDescriptorDigest: null,
				},
			],
		};
	}
	if (response.role === PlanningVocabulary.Role.Draft) {
		const prose = response.artifactEdits[0]?.content;
		if (!prose) throw new Error('Expected complete draft prose');
		return {
			...response,
			artifactEdits: snapshot.record.artifacts
				.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data)
				.map((artifact) => ({
					path: artifact.path,
					baseHash: artifact.sha256,
					content:
						artifact.variant === PlanningVocabulary.Artifact.Overview
							? '# Retry system\n\n## Context\n\nPreserve retry completion and report it.\n\n## Cross-Phase Dependencies\n\nPhase B preserves phase A completion.\n'
							: artifact.path === 'phase2-report.md'
								? prose.replaceAll('retryUpload', 'retryReport')
								: prose,
				})),
		};
	}
	return response;
};

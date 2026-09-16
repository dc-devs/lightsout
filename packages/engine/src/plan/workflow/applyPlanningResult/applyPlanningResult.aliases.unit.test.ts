import { expect, test } from '@jest/globals';
import { type PlanningEvidence, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningArchitectProposalFixture } from '#tests/helpers/planningArchitectProposalFixture.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const setupArchitecture = async ({ variant }: { variant: string }) =>
	planningArchitectProposalFixture({
		respond: async ({ response, snapshot }) => {
			if (response.role !== PlanningVocabulary.Role.Architect || response.kind !== PlanningVocabulary.ResultKind.Terminal) return response;
			const parent = snapshot.record.work.find((work) => work.id === response.workId);
			if (!parent) throw new Error('Current architecture is required');
			const role =
				variant === 'draft'
					? PlanningVocabulary.Role.Draft
					: variant === 'integration'
						? PlanningVocabulary.Role.IntegrationReview
						: PlanningVocabulary.Role.Investigate;
			const work: PlanningWork = {
				...parent,
				id: 'new-work',
				role,
				status: PlanningVocabulary.WorkState.Pending,
				attemptSequence: 0,
				currentAttemptId: undefined,
				resultReceiptId: undefined,
				prerequisiteIds: [],
				failureIds: [],
				diagnosisIds: [],
				stage: PlanningVocabulary.Stage.Brainstorm,
			};
			return {
				...response,
				work: [work],
				...(variant === 'phase'
					? {
							artifactLayouts: [
								...(response.artifactLayouts ?? []),
								{
									path: 'phase1-new.md',
									variant: PlanningVocabulary.Artifact.Phase,
									phaseId: 'new-phase',
									claimIds: ['upload-architecture'],
									prerequisiteIds: [],
									exports: ['retryUpload'],
									boundaries: { kind: PlanningVocabulary.Scope.Selected, claimIds: ['upload-architecture'], phaseIds: ['new-phase'], packageRoots: [] },
									baseDescriptorDigest: null,
								},
							],
						}
					: {}),
			};
		},
	});

test.each(['draft', 'integration', 'investigate', 'phase'])(
	'resolves linked proposal aliases and applies the required role prerequisites: %s',
	async (variant) => {
		const fixture = await setupArchitecture({ variant });

		const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

		expect(result.accepted).toBe(true);
		const added = result.snapshot.record.work.find((work) => work.id.startsWith(`work:${fixture.result.attemptId}:`));
		expect(added).toEqual(
			expect.objectContaining({
				status: 'pending',
				attemptSequence: 0,
				stage: 'implementation',
				prerequisiteIds: variant === 'draft' ? ['initial:design-review'] : variant === 'integration' ? ['initial:implementation-review'] : [],
			}),
		);
		if (variant === 'phase') {
			const phase = result.snapshot.record.artifacts.find((artifact) => artifact.path === 'phase1-new.md');
			const architecture = result.snapshot.record.claims.find((claim) => claim.id.startsWith(`claim:${fixture.result.attemptId}:`));
			expect(phase).toEqual(
				expect.objectContaining({
					phaseId: expect.stringMatching(/^phase:/),
					claimIds: [architecture?.id],
					boundaries: expect.objectContaining({ claimIds: [architecture?.id], phaseIds: [phase?.phaseId] }),
				}),
			);
			expect(result.snapshot.artifacts.get('phase1-new.md')).toContain('detailed authoring is still required');
		}
	},
);

const setupInvestigation = async ({ variant }: { variant: string }) =>
	planningRoleProposalFixture({
		role: PlanningVocabulary.Role.Investigate,
		arrange: ({ record, work }) => {
			const { confirmationId: _approval, ...original } = record.claims[0];
			record.claims.push({ ...original, id: 'technical-old', owner: PlanningVocabulary.Owner.Planner, dependencies: ['required'] });
			record.findings.push(planningWorkflowFinding({ id: 'existing-finding', scope: work.scope }));
			if (variant === 'scope') work.scope = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: ['packages/engine'] };
		},
		respond: ({ response, snapshot }) => {
			if (response.role !== PlanningVocabulary.Role.Investigate || response.kind !== PlanningVocabulary.ResultKind.Terminal)
				throw new Error('Expected investigation');
			const old = snapshot.record.claims.find((claim) => claim.id === 'technical-old');
			const parent = snapshot.record.work.find((work) => work.id === response.workId);
			if (!old || !parent) throw new Error('Actual semantic predecessors are required');
			if (variant === 'successor')
				return {
					...response,
					claims: [
						{ ...old, state: PlanningVocabulary.ClaimState.Superseded },
						{ ...old, id: 'technical-new', supersedes: old.id, text: 'Preserve retry identity in the existing upload service.' },
					],
				};
			if (variant === 'scope') return { ...response, claims: [{ ...old, id: 'outside-scope' }] };
			if (variant === 'existing-work')
				return {
					...response,
					work: [
						{
							...parent,
							status: PlanningVocabulary.WorkState.Pending,
							attemptSequence: 0,
							currentAttemptId: undefined,
							resultReceiptId: undefined,
							failureIds: [],
							diagnosisIds: [],
						},
					],
				};
			if (variant === 'existing-finding') return { ...response, findings: snapshot.record.findings.filter((finding) => finding.id === 'existing-finding') };
			const evidence: PlanningEvidence = {
				id: 'new-evidence',
				assignmentId: parent.id,
				claimIds: ['required'],
				dependencies:
					variant === 'unacquired' ? [{ id: 'invented', kind: PlanningVocabulary.Dependency.Content, path: 'unobserved.ts', sha256: 'a'.repeat(64) }] : [],
				conclusion: 'The retry identity remains unresolved.',
				uncertaintyIds: [],
				complete: variant !== 'incomplete',
				acquisition: 'Explicit semantic interpretation of the captured requirement',
				dependencyReach: PlanningVocabulary.DependencyReach.Known,
				sourceIds: [],
				configDigest: 'a'.repeat(64),
				standardsDigest: 'a'.repeat(64),
			};
			return { ...response, evidence: [evidence] };
		},
	});

test('preserves a technical predecessor and resolves a new successor identity atomically', async () => {
	const fixture = await setupInvestigation({ variant: 'successor' });

	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.claims.find((claim) => claim.id === 'technical-old')?.state).toBe('superseded');
	expect(result.snapshot.record.claims.find((claim) => claim.supersedes === 'technical-old')).toEqual(
		expect.objectContaining({
			id: expect.stringMatching(/^claim:/),
			state: 'settled',
			dependencies: ['required'],
			text: 'Preserve retry identity in the existing upload service.',
		}),
	);
	expect(result.snapshot.record.claims.find((claim) => claim.id === 'required')).toStrictEqual(
		fixture.before.record.claims.find((claim) => claim.id === 'required'),
	);
});

test.each(['scope', 'existing-work', 'existing-finding', 'unacquired', 'incomplete'])(
	'rejects a semantic proposal without its required scope or evidence authority: %s',
	async (variant) => {
		const fixture = await setupInvestigation({ variant });

		await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(
			/assigned scope|existing work item|existing finding|unacquired evidence|stale semantic conclusions/,
		);

		expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
	},
);

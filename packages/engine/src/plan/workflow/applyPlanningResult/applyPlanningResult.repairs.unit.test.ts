import { expect, test } from '@jest/globals';
import { FindingSeverity, PlanningVocabulary, StructuralCheck } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const setupRepair = async ({ variant }: { variant: string }) =>
	planningRoleProposalFixture({
		role: PlanningVocabulary.Role.Repair,
		arrange: ({ record, work }) => {
			const finding = planningWorkflowFinding({ id: 'retry-gap', scope: work.scope });
			if (variant === 'withdrawn') {
				finding.state = PlanningVocabulary.FindingState.Withdrawn;
				const source = record.sources[0];
				finding.citations = [{ artifact: `planning-originals/${source.sha256}.txt`, sha256: source.sha256, quote: source.text }];
			}
			record.findings.push(finding);
		},
		respond: ({ response }) => {
			if (response.role !== PlanningVocabulary.Role.Repair || response.kind !== PlanningVocabulary.ResultKind.Terminal) throw new Error('Expected repair');
			return {
				...response,
				resolutions: [
					{
						findingId: variant === 'missing-finding' ? 'absent' : 'retry-gap',
						claimIds: variant === 'missing-claim' ? ['absent'] : variant === 'claim-only' ? ['required'] : [],
						artifacts: variant === 'empty' || variant === 'claim-only' ? [] : variant === 'missing-artifact' ? ['absent.md'] : ['plan.md'],
						explanation: 'The repaired plan preserves upload retry identity.',
					},
				],
			};
		},
	});

test.each(['missing-finding', 'withdrawn', 'empty', 'missing-claim', 'missing-artifact'])(
	'refuses repair closure without existing concrete outputs: %s',
	async (variant) => {
		const fixture = await setupRepair({ variant });

		await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(/Repair references|repair must identify/i);

		expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
	},
);

test('records a claim-based repair as awaiting independent verification', async () => {
	const fixture = await setupRepair({ variant: 'claim-only' });

	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.findings.find((finding) => finding.id === 'retry-gap')).toEqual(
		expect.objectContaining({ state: 'repairing', resolutionClaimIds: ['required'], resolutionArtifacts: [], verificationReceiptIds: [] }),
	);
});

const setupReview = async ({ variant }: { variant: string }) => {
	const fixture = await planningRoleProposalFixture({
		role: PlanningVocabulary.Role.ImplementationReview,
		arrange: ({ record, work }) => {
			const finding = planningWorkflowFinding({ id: variant === 'structural' ? 'structural:retry-gap' : 'retry-gap', scope: work.scope });
			finding.state = variant === 'open' ? PlanningVocabulary.FindingState.Open : PlanningVocabulary.FindingState.Repairing;
			finding.resolutionArtifacts = ['plan.md'];
			finding.proposedResolution = 'The current plan supplies the required retry contract.';
			record.findings.push(finding);
		},
		respond: ({ response, snapshot }) => {
			if (response.kind !== PlanningVocabulary.ResultKind.Terminal || !('coverage' in response)) throw new Error('Expected review');
			const plan = snapshot.record.artifacts.find((artifact) => artifact.path === 'plan.md');
			const text = snapshot.artifacts.get('plan.md');
			if (!plan || !text) throw new Error('Review requires actual current plan bytes');
			const citation = {
				artifact: 'plan.md',
				sha256: variant === 'stale' ? 'c'.repeat(64) : plan.sha256,
				quote: variant === 'invented' ? 'Unobserved behavior' : text,
			};
			return {
				...response,
				verifiedFindings: [
					{ findingId: variant === 'missing' ? 'absent' : variant === 'structural' ? 'structural:retry-gap' : 'retry-gap', citations: [citation] },
				],
			};
		},
	});
	if (variant === 'structural')
		fixture.runtime.services.validate = async () => [
			{
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				phase: 'plan.md',
				location: 'plan.md',
				issue: 'Retry after structural:retry-gap loses the completed upload',
				fix: 'Preserve retry identity for structural:retry-gap',
			},
		];
	return fixture;
};

test.each(['open', 'missing', 'stale', 'invented', 'structural'])('refuses independent verification without current repair evidence: %s', async (variant) => {
	const fixture = await setupReview({ variant });

	await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(/unrepaired finding|Citation|deterministic defect/);

	expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
});

test('binds independently verified repair to its real current reviewer attempt', async () => {
	const fixture = await setupReview({ variant: 'current' });

	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

	expect(result.accepted).toBe(true);
	const receipt = result.snapshot.record.reviewReceipts.find((receipt) => receipt.attemptId === fixture.result.attemptId);
	expect(receipt?.authorAttemptIds).not.toContain(fixture.result.attemptId);
	expect(result.snapshot.record.findings.find((finding) => finding.id === 'retry-gap')).toEqual(
		expect.objectContaining({ state: 'verified', verificationReceiptIds: [receipt?.id] }),
	);
	expect(receipt?.verifiedFindings).toEqual([
		expect.objectContaining({ findingId: 'retry-gap', citations: [expect.objectContaining({ artifact: 'plan.md' })] }),
	]);
});

test('verifies a repaired structural finding after its exact deterministic check clears', async () => {
	const fixture = await setupReview({ variant: 'structural' });
	fixture.runtime.services.validate = async () => [];
	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	expect(result.accepted).toBe(true);
	const receipt = result.snapshot.record.reviewReceipts.find((receipt) => receipt.attemptId === fixture.result.attemptId);
	expect(receipt?.verifiedFindings).toEqual([expect.objectContaining({ findingId: 'structural:retry-gap' })]);
	expect(result.snapshot.record.findings.find((finding) => finding.id === 'structural:retry-gap')).toEqual(
		expect.objectContaining({ state: 'verified', verificationReceiptIds: [receipt?.id] }),
	);
});

import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const setup = async ({
	role,
	dispute = false,
	invalidCitation = false,
	insufficient = false,
	user = false,
}: {
	role: typeof PlanningVocabulary.Role.DesignReview | typeof PlanningVocabulary.Role.ImplementationReview | typeof PlanningVocabulary.Role.IntegrationReview;
	dispute?: boolean;
	invalidCitation?: boolean;
	insufficient?: boolean;
	user?: boolean;
}) =>
	planningRoleProposalFixture({
		role,
		respond: ({ response, snapshot }) => {
			if (response.kind !== 'terminal' || !('coverage' in response)) throw new Error('Expected independent review');
			const work = snapshot.record.work.find((work) => work.id === response.workId);
			if (!work) throw new Error('Expected current assignment');
			const finding = planningWorkflowFinding({ id: 'retention-conflict', scope: work.scope });
			if (user) finding.owner = PlanningVocabulary.Owner.User;
			const source = snapshot.record.sources[0];
			return {
				...response,
				findings: insufficient ? [] : [finding],
				verifiedFindings: [],
				coverage: { ...response.coverage, outcome: insufficient ? PlanningVocabulary.Review.Insufficient : PlanningVocabulary.Review.Adequate },
				...(dispute
					? {
							adjudicationRequests: [
								{
									reason: PlanningVocabulary.Dispute.ConflictingReports,
									findingIds: [finding.id],
									explanation: 'Conflicting reports disagree whether original retention already guarantees retry or needs a new adapter contract.',
									citations: [
										{
											artifact: `planning-originals/${source.sha256}.txt`,
											sha256: source.sha256,
											quote: invalidCitation ? 'An invented approval' : source.text,
										},
									],
								},
							],
						}
					: {}),
			};
		},
	});

test.each([PlanningVocabulary.Role.DesignReview, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview])(
	'routes a clear finding straight to repair and a distinct matching recheck: %s',
	async (role) => {
		const fixture = await setup({ role });
		const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
		expect(result.accepted).toBe(true);
		const repair = result.snapshot.record.work.find((work) => work.id === `followup:${fixture.result.attemptId}:repair`);
		const recheck = result.snapshot.record.work.find((work) => work.id === `followup:${fixture.result.attemptId}:recheck`);
		expect(repair).toEqual(expect.objectContaining({ role: 'repair', status: 'pending', prerequisiteIds: [fixture.work.id] }));
		expect(recheck).toBeUndefined();
		expect(result.snapshot.record.work.find((work) => work.id === fixture.work.id)).toEqual(
			expect.objectContaining({ role, status: 'complete', currentAttemptId: fixture.result.attemptId }),
		);
		expect(result.snapshot.record.reviewReceipts.at(-1)).toEqual(
			expect.objectContaining({ workId: fixture.work.id, findingIds: [result.snapshot.record.findings.at(-1)?.id] }),
		);
		expect(result.snapshot.record.work.some((work) => work.role === 'adjudicate')).toBe(false);
		expect(result.snapshot.record.findings.at(-1)?.state).toBe('open');
	},
);

test.each([PlanningVocabulary.Role.DesignReview, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview])(
	'creates a current review obligation for explicitly incomplete coverage: %s',
	async (role) => {
		const fixture = await setup({ role, insufficient: true });
		const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
		expect(result.accepted).toBe(true);
		expect(result.snapshot.record.work.find((work) => work.id === `followup:${fixture.result.attemptId}:coverage`)).toEqual(
			expect.objectContaining({ role, status: 'pending', prerequisiteIds: [fixture.work.id] }),
		);
		expect(result.snapshot.record.reviewReceipts.at(-1)?.coverage.outcome).toBe('insufficient');
	},
);

test('routes an explicit evidenced dispute to adjudication without automatic repair', async () => {
	const fixture = await setup({ role: PlanningVocabulary.Role.DesignReview, dispute: true });
	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	const followups = result.snapshot.record.work.filter((work) => work.id.startsWith(`followup:${fixture.result.attemptId}:`));
	expect(result.accepted).toBe(true);
	expect(followups).toHaveLength(1);
	expect(followups[0]).toEqual(expect.objectContaining({ role: 'adjudicate', prerequisiteIds: [fixture.work.id] }));
	const request = [...result.snapshot.artifacts].find(([path]) => path.startsWith('planning-adjudication-requests/'));
	expect(JSON.parse(request?.[1] ?? '{}')).toEqual(
		expect.objectContaining({ workId: followups[0].id, request: expect.objectContaining({ findingIds: [result.snapshot.record.findings.at(-1)?.id] }) }),
	);
});

test('rejects an explicit dispute whose supporting quote was never observed', async () => {
	const fixture = await setup({ role: PlanningVocabulary.Role.DesignReview, dispute: true, invalidCitation: true });
	await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(/Citation/);
	expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
});

test('preserves a user-owned conflict without scheduling technical repair as its answer', async () => {
	const fixture = await setup({ role: PlanningVocabulary.Role.DesignReview, user: true });
	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.findings.at(-1)).toEqual(expect.objectContaining({ owner: 'user', state: 'open' }));
	expect(result.snapshot.record.work.some((work) => work.id.startsWith(`followup:${fixture.result.attemptId}:`))).toBe(false);
});

import { expect, test } from '@jest/globals';
import { PlanningVocabulary as V } from '#src/contracts/index.ts';
import { resolvePlanningFindings } from '#src/plan/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

test('preserves repeated observations, deduplicates follow-up work, and rejects altered or unowned finding proposals', async () => {
	const fixture = await planningRoleProposalFixture({ role: V.Role.DesignReview });
	if (!('findings' in fixture.result)) throw new Error('Expected actual independent review result');
	const finding = planningWorkflowFinding({ id: 'repeat-observation', scope: fixture.scope });
	const proposals = { ...fixture.result, findings: [finding] };
	const first = resolvePlanningFindings({ snapshot: fixture.before, proposals });
	expect(first.findings).toContainEqual(finding);
	expect(first.work.map((work) => work.role)).toStrictEqual([V.Role.Repair, V.Role.DesignReview]);
	const repeated = { ...fixture.before, record: { ...fixture.before.record, findings: first.findings, work: [...fixture.before.record.work, ...first.work] } };
	expect(resolvePlanningFindings({ snapshot: repeated, proposals })).toStrictEqual({ findings: first.findings, work: [] });
	expect(() =>
		resolvePlanningFindings({
			snapshot: repeated,
			proposals: { ...proposals, findings: [{ ...finding, consequence: 'Silently replaced the original observation' }] },
		}),
	).toThrow('persistent finding meaning');
	expect(() => resolvePlanningFindings({ snapshot: fixture.before, proposals: { ...proposals, workId: 'unowned-review' } })).toThrow(
		'actual originating assignment',
	);
	expect(() =>
		resolvePlanningFindings({
			snapshot: fixture.before,
			proposals: {
				...proposals,
				adjudicationRequests: [
					{
						findingIds: ['missing-observation'],
						reason: V.Dispute.ConflictingReports,
						explanation: 'A dispute must name a real retained observation.',
						citations: finding.citations,
					},
				],
			},
		}),
	).toThrow('unknown observation');
});

import { expect, test } from '@jest/globals';
import { PlanningVocabulary as V } from '#src/contracts/index.ts';
import { applyPlanningInvalidation } from '#src/plan/workflow/common/utils/applyPlanningInvalidation.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const invalidation = { workIds: [], receiptIds: [], reason: 'Changed evidence requires fresh review.' };

test('refuses unknown authority and prevents acceptance from invalidating its own author', async () => {
	const fixture = await planningReviewFixture();
	const snapshot = await fixture.capture();
	const author = snapshot.record.work[0];
	expect(() => applyPlanningInvalidation({ record: structuredClone(snapshot.record), invalidation: { ...invalidation, workIds: ['missing'] } })).toThrow(
		'unknown work',
	);
	expect(() =>
		applyPlanningInvalidation({ record: structuredClone(snapshot.record), invalidation: { ...invalidation, workIds: [author.id] }, authorWorkId: author.id }),
	).toThrow('just-accepted');
	expect(() =>
		applyPlanningInvalidation({ record: structuredClone(snapshot.record), invalidation: { ...invalidation, reopenFindingIds: ['missing'] } }),
	).toThrow('unknown finding');
	for (const work of [author, { ...author, id: 'already-started', attemptSequence: 1 }, { ...author, id: 'interrupted', status: V.WorkState.Interrupted }]) {
		expect(() => applyPlanningInvalidation({ record: structuredClone(snapshot.record), invalidation: { ...invalidation, work: [work] } })).toThrow(
			'new unstarted',
		);
	}
});

test('reopens withdrawn and verified obligations without changing still-open observations', async () => {
	const fixture = await planningReviewFixture();
	const snapshot = await fixture.capture();
	for (const state of [V.FindingState.Withdrawn, V.FindingState.Verified, V.FindingState.Open, V.FindingState.Repairing]) {
		const record = structuredClone(snapshot.record);
		const finding = { ...planningWorkflowFinding({ id: 'stale-settlement', scope: fixture.scope }), state };
		record.findings.push(finding);
		applyPlanningInvalidation({ record, invalidation: { ...invalidation, reopenFindingIds: [finding.id] } });
		expect(finding.state).toBe(state === V.FindingState.Withdrawn ? V.FindingState.Open : state === V.FindingState.Verified ? V.FindingState.Repairing : state);
		expect(finding.observationIds).toStrictEqual(record.findings[0].observationIds);
	}
});

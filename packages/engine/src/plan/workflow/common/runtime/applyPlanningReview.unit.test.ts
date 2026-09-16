import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningReview } from '#src/plan/workflow/common/runtime/applyPlanningReview.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { readPlanningInvocation } from '#src/plan/workflow/common/runtime/readPlanningInvocation.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';

const setup = async () => {
	const fixture = await planningRoleProposalFixture({ role: PlanningVocabulary.Role.ImplementationReview });
	const invocation = readPlanningInvocation({ snapshot: fixture.before, workId: fixture.work.id });
	if (!invocation) throw new Error('Expected recorded independent invocation');
	if (!('coverage' in fixture.result)) throw new Error('Expected review response');
	const previous = { ...structuredClone(fixture.before), artifacts: new Map(fixture.before.artifacts) };
	return {
		runtime: fixture.runtime,
		previous,
		record: structuredClone(fixture.before.record),
		artifacts: new Map(fixture.before.artifacts),
		result: fixture.result,
		invocation,
	};
};

test.each(['absent', 'same-attempt'])('refuses independent approval with %s author identity', async (defect) => {
	const params = await setup();
	for (const work of params.record.work) if (work.role === 'architect') work.currentAttemptId = defect === 'absent' ? undefined : params.result.attemptId;
	await expect(applyPlanningReview(params)).rejects.toThrow('distinct actual author attempts');
	expect(params.record.reviewReceipts).toStrictEqual(params.previous.record.reviewReceipts);
});

test.each(['missing-obligation', 'missing-basis', 'missing-assessment'])('refuses assurance review without %s', async (defect) => {
	const params = await setup();
	params.result.workId = 'assurance:test';
	if (defect !== 'missing-obligation')
		attachPlanningData({
			record: params.previous.record,
			artifacts: params.previous.artifacts,
			path: 'planning-assurance-obligations/test.json',
			value: { cycleId: 'current-cycle', workId: 'assurance:test', basis: 'a'.repeat(64), dependencyIds: ['unknown'] },
		});
	if (defect === 'missing-assessment') {
		params.invocation.assuranceBasis = 'a'.repeat(64);
		if ('unknownAssessments' in params.result) delete params.result.unknownAssessments;
	}
	await expect(applyPlanningReview(params)).rejects.toThrow(/recorded obligation|invocation basis|explicit assessment/);
});

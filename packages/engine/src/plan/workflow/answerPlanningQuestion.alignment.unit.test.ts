import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary as V } from '#src/contracts/index.ts';
import { answerPlanningQuestion, evaluatePlanningReadiness } from '#src/plan/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { planningQuestionAnswer } from '#tests/helpers/planningWorkflowQuestionScenario.ts';

test('rejects caller-supplied alignment authority and a revision option without the requested change', async () => {
	const fixture = await planningReviewFixture({ stage: V.Stage.Brainstorm });
	const result = await fixture.run();
	if (result.status !== V.Status.AwaitingUser) throw new Error('Expected actual final-design approval checkpoint');
	const before = await fixture.current();
	const answer = planningQuestionAnswer({ result, delegation: fixture.scope, alignment: true });
	const forged = {
		...answer,
		confirmation: { ...answer.confirmation, alignment: { sourceDigest: 'a'.repeat(64), semanticDigest: 'b'.repeat(64), challengeReceiptId: 'invented' } },
	};
	await expect(answerPlanningQuestion({ runtime: fixture.runtime, answer: forged })).rejects.toThrow('Only the engine');
	const revision = result.question.options[1].label;
	await expect(
		answerPlanningQuestion({
			runtime: fixture.runtime,
			answer: {
				...answer,
				selectedOption: revision,
				confirmation: { ...answer.confirmation, messageText: revision, approvedDigest: sha256({ content: revision }) },
			},
		}),
	).rejects.toThrow('actual requested change');
	expect((await fixture.current()).digest).toBe(before.digest);
}, 60_000);

test('records requested design changes as original intent and requires a new challenge before alignment', async () => {
	const fixture = await planningReviewFixture({ stage: V.Stage.Brainstorm });
	const result = await fixture.run();
	if (result.status !== V.Status.AwaitingUser) throw new Error('Expected actual final-design approval checkpoint');
	const old = await fixture.current();
	const text = 'Also preserve uploads when a retry is canceled before starting.';
	const answer = planningQuestionAnswer({ result, delegation: fixture.scope });
	answer.freeText = text;
	answer.confirmation.messageText = text;
	answer.confirmation.approvedDigest = sha256({ content: text });
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async () => ({ text: 'No provider capacity for the fresh challenge', exitCode: 1, rateLimited: true }),
	};
	expect((await answerPlanningQuestion({ runtime: fixture.runtime, answer })).status).toBe(V.Status.ExternallyBlocked);
	const changed = await fixture.current();
	expect(changed.record.sources).toEqual(expect.arrayContaining(old.record.sources));
	expect(changed.record.sources).toContainEqual(expect.objectContaining({ text, sha256: answer.confirmation.approvedDigest }));
	expect(changed.record.confirmations.find((confirmation) => confirmation.id === answer.confirmation.id)?.alignment).toBeUndefined();
	expect(changed.record.claims).toContainEqual(expect.objectContaining({ text, owner: V.Owner.User, confirmationId: answer.confirmation.id }));
	expect(evaluatePlanningReadiness({ snapshot: changed, stage: V.Stage.Brainstorm, structural: [], dependenciesCurrent: true }).ready).toBe(false);
}, 60_000);

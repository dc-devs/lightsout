import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { answerPlanningQuestion, capturePlanningInput, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';
import { planningQuestionAnswer } from '#tests/helpers/planningWorkflowQuestionScenario.ts';

const setup = async ({ variant }: { variant: string }) => {
	const fixture = await planningWorkflowFixture();
	const before = await fixture.capture();
	const input = structuredClone(fixture.input);
	if (variant === 'stage') input.stage = PlanningVocabulary.Stage.Brainstorm;
	if (variant === 'confirmation') input.confirmations[0].messageId = 'substituted-message';
	if (variant === 'claim') input.claims[0].explanation = 'Substituted approved explanation';
	if (variant === 'missing-predecessor') input.claims = [{ ...input.claims[0], id: 'replacement', supersedes: 'missing' }];
	if (variant === 'unconfirmed')
		input.claims = [
			{ ...input.claims[0], id: 'replacement', supersedes: 'required', state: PlanningVocabulary.ClaimState.Unresolved, confirmationId: undefined },
		];
	return { ...fixture, before, input };
};

test.each(['stage', 'confirmation', 'claim', 'missing-predecessor', 'unconfirmed'])(
	'rejects unauthorised input replacement while preserving the existing generation: %s',
	async (variant) => {
		const fixture = await setup({ variant });

		await expect(capturePlanningInput({ runtime: fixture.runtime, input: fixture.input })).rejects.toThrow(
			/stages disagree|cannot be rewritten|explicit superseding|unknown claim|Unconfirmed input/,
		);

		expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
	},
);

test('adds implementation obligations on stage handoff while preserving captured brainstorm history', async () => {
	const fixture = await planningWorkflowFixture({ stage: PlanningVocabulary.Stage.Brainstorm });
	const before = await fixture.capture();
	fixture.runtime.stage = PlanningVocabulary.Stage.Implementation;

	const result = await capturePlanningInput({ runtime: fixture.runtime, input: { stage: fixture.runtime.stage, sources: [], claims: [], confirmations: [] } });

	expect(result.record.sources).toStrictEqual(before.record.sources);
	expect(result.record.confirmations).toStrictEqual(before.record.confirmations);
	expect(result.record.work.filter((work) => work.stage === 'brainstorm')).toStrictEqual(before.record.work);
	expect(
		result.record.work.filter((work) => work.stage === 'implementation').map((work) => ({ id: work.id, prerequisites: work.prerequisiteIds })),
	).toContainEqual({ id: 'implementation:initial:draft', prerequisites: ['implementation:initial:design-review'] });
});

test('returns a concrete missing-input blocker before dispatching any planning role', async () => {
	const fixture = await planningWorkflowFixture();

	const result = await runPlanning({ runtime: fixture.runtime });

	expect(result).toEqual(expect.objectContaining({ status: 'externally-blocked', cause: expect.stringContaining('Original planning input is missing') }));
	expect(fixture.calls).toHaveLength(0);
});

test('preserves accepted brainstorm work when new implementation input arrives after handoff', async () => {
	const fixture = await planningWorkflowFixture({ stage: PlanningVocabulary.Stage.Brainstorm });
	await fixture.capture();
	const question = await runPlanning({ runtime: fixture.runtime });
	if (question.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected independent design challenge before explicit approval');
	const aligned = await answerPlanningQuestion({
		runtime: fixture.runtime,
		answer: planningQuestionAnswer({ result: question, delegation: fixture.scope, alignment: true }),
	});
	if (aligned.status !== 'aligned') throw new Error('Expected actual brainstorm alignment');
	const before = await readPlanningSnapshot(fixture);
	if (!before) throw new Error('Expected aligned snapshot');
	fixture.runtime.stage = PlanningVocabulary.Stage.Implementation;
	await capturePlanningInput({ runtime: fixture.runtime, input: { stage: fixture.runtime.stage, sources: [], claims: [], confirmations: [] } });
	const text = 'Preserve metadata on retry as well.';
	const result = await capturePlanningInput({
		runtime: fixture.runtime,
		input: {
			stage: fixture.runtime.stage,
			claims: [],
			confirmations: [],
			sources: [{ artifact: 'implementation-context.md', locator: 'Technical requirement', text, sha256: sha256({ content: text }) }],
		},
	});
	expect(result.record.work.filter((work) => work.stage === 'brainstorm')).toStrictEqual(before.record.work);
	expect(result.record.reviewReceipts).toStrictEqual(before.record.reviewReceipts);
	expect(result.record.sources).toContainEqual(expect.objectContaining({ artifact: 'implementation-context.md', text }));
	expect(result.record.work.filter((work) => work.stage === 'implementation').every((work) => work.status === 'pending')).toBe(true);
});

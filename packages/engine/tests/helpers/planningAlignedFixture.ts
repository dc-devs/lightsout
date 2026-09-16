import { PlanningVocabulary } from '#src/contracts/index.ts';
import { answerPlanningQuestion, createPlanningRuntime, exportBrainstormGeneration } from '#src/plan/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { planningQuestionAnswer } from '#tests/helpers/planningWorkflowQuestionScenario.ts';

/** Real independent challenge and explicit exact foreground alignment, using only an injected semantic provider. */
export const planningAlignedFixture = async ({
	name = 'lo-144-design',
	approved = true,
	portable = true,
}: {
	name?: string;
	approved?: boolean;
	portable?: boolean;
} = {}) => {
	const fixture = await planningReviewFixture({ name, stage: PlanningVocabulary.Stage.Brainstorm });
	const runtime = await createPlanningRuntime({
		...fixture,
		driver: fixture.runtime.driver,
		config: fixture.runtime.config,
		mode: fixture.runtime.mode,
		stage: fixture.runtime.stage,
	});
	Object.assign(fixture.runtime, runtime);
	const question = await fixture.run();
	if (question.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error(`Expected real alignment question: ${JSON.stringify(question)}`);
	if (approved) {
		const aligned = await answerPlanningQuestion({ runtime, answer: planningQuestionAnswer({ result: question, delegation: fixture.scope, alignment: true }) });
		if (aligned.status !== PlanningVocabulary.Status.Aligned) throw new Error(`Expected approved brainstorm: ${JSON.stringify(aligned)}`);
	}
	const snapshot = await fixture.current();
	return { ...fixture, runtime, snapshot, files: approved && portable ? exportBrainstormGeneration({ snapshot }) : new Map<string, string>() };
};

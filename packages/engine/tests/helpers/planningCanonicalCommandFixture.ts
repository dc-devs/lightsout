import { PlanningVocabulary } from '#src/contracts/index.ts';
import { createPlanningRuntime, runPlanning } from '#src/plan/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

/** A real production-planned generation with an injected provider; CLI checks never invoke a paid harness. */
export const planningCanonicalCommandFixture = async ({
	complete = true,
	proposal = false,
	finding = false,
}: {
	complete?: boolean;
	proposal?: boolean;
	finding?: boolean;
} = {}) => {
	const fixture = await planningReviewFixture();
	const config = { ...fixture.runtime.config, 'auto-plan': { 'auto-approve-plan': !proposal, 'propose-before-draft': false } };
	const runtime = await createPlanningRuntime({ ...fixture, config, driver: fixture.runtime.driver, mode: fixture.runtime.mode, stage: fixture.runtime.stage });
	Object.assign(fixture.runtime, runtime);
	await fixture.capture();
	if (complete) await runPlanning({ runtime });
	if (finding)
		await fixture.accept({
			role: PlanningVocabulary.Role.ImplementationReview,
			propose: ({ response }) => {
				if (!('findings' in response) || !('coverage' in response)) throw new Error('Expected an independent review');
				return {
					...response,
					findings: [planningWorkflowFinding({ id: 'existing-retry-helper', scope: fixture.scope })],
					coverage: { ...response.coverage, outcome: PlanningVocabulary.Review.Insufficient },
				};
			},
		});
	const output = captureCommandOutput();
	return { ...fixture, ...output, runtime, params: { ...fixture, driver: runtime.driver, config, standards: undefined }, callsBefore: fixture.calls.length };
};

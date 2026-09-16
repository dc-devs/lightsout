import { PlanningVocabulary } from '#src/contracts/index.ts';
import { createPlanningRuntime, ensurePlanningInput } from '#src/plan/index.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';

/** A genuinely approved design handed into implementation planning, with immutable archived authority. */
export const planningBrainstormHandoffFixture = async () => {
	const fixture = await planningAlignedFixture();
	const runtime = await createPlanningRuntime({
		...fixture,
		driver: fixture.runtime.driver,
		config: fixture.runtime.config,
		mode: fixture.runtime.mode,
		stage: PlanningVocabulary.Stage.Implementation,
	});
	const snapshot = await ensurePlanningInput({ runtime });
	return { ...fixture, runtime, snapshot, aligned: fixture.snapshot };
};

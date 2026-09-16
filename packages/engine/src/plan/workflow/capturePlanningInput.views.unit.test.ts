import { expect, jest, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { capturePlanningInput } from '#src/plan/index.ts';
import { renderPlanningSections } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

test('capturePlanningInput preserves pre-draft prose when a semantic input arrives before generated views exist', async () => {
	const fixture = await planningDraftFixture();
	const render = jest.fn<typeof renderPlanningSections>(renderPlanningSections);
	fixture.runtime.services.render = render;
	const source = fixture.snapshot.record.claims[0];
	const claim = {
		...source,
		id: 'technical-obligation',
		text: 'Retain retry ownership before allocating detailed authoring work.',
		owner: PlanningVocabulary.Owner.Planner,
		confirmationId: undefined,
	};

	const saved = await capturePlanningInput({
		runtime: fixture.runtime,
		input: { stage: fixture.runtime.stage, sources: [], claims: [claim], confirmations: [] },
	});

	expect(saved.record.claims).toContainEqual(claim);
	expect(render).not.toHaveBeenCalled();
	for (const artifact of fixture.snapshot.record.artifacts.filter(({ variant }) => variant !== PlanningVocabulary.Artifact.Data))
		expect(saved.artifacts.get(artifact.path)).toBe(fixture.snapshot.artifacts.get(artifact.path));
	expect(saved.record.artifacts.find(({ phaseId }) => phaseId === 'A')).toEqual(fixture.snapshot.record.artifacts.find(({ phaseId }) => phaseId === 'A'));
});

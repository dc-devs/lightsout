import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { draftPlanningArtifacts } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

describe('draftPlanningArtifacts', () => {
	test.each([PlanningVocabulary.Role.Architect, PlanningVocabulary.Role.ImplementationReview])(
		'refuses %s as an authoring assignment before invoking a provider',
		async (role) => {
			const fixture = await planningDraftFixture();
			const work = { ...fixture.work, role };

			const draft = draftPlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, work });

			await expect(draft).rejects.toThrow('Planning authoring requires a draft or repair assignment');
			expect(fixture.calls).toHaveLength(0);
		},
	);

	test('refuses drafting without an established layout before invoking a provider', async () => {
		const fixture = await planningDraftFixture();
		const snapshot = structuredClone(fixture.snapshot);
		snapshot.record.artifacts = snapshot.record.artifacts.filter(({ variant }) => variant === PlanningVocabulary.Artifact.Data);
		const work = { ...fixture.work, role: PlanningVocabulary.Role.Draft };

		const draft = draftPlanningArtifacts({ runtime: fixture.runtime, snapshot, work });

		await expect(draft).rejects.toThrow('Planning drafting requires an established artifact layout');
		expect(fixture.calls).toHaveLength(0);
	});
});

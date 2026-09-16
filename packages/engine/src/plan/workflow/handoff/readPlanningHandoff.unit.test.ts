import { expect, test } from '@jest/globals';
import { readPlanningHandoff } from '#src/plan/workflow/handoff/readPlanningHandoff.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

test('refuses a missing original generation instead of resolving the current plan', async () => {
	const fixture = await planningHandoffFixture();
	await expect(readPlanningHandoff({ ...fixture, handoff: { ...fixture.handoff, generation: 'a'.repeat(64) } })).rejects.toThrow();
});

test('refuses an unfinished original generation', async () => {
	const fixture = await planningWorkflowFixture();
	const snapshot = await fixture.capture();
	await expect(
		readPlanningHandoff({ ...fixture, handoff: { format: 'planning-handoff-v1', name: fixture.name, generation: snapshot.digest, phases: [] } }),
	).rejects.toThrow('no completed planning cycle');
});

test('refuses caller-supplied phase order differing from approved order', async () => {
	const fixture = await planningHandoffFixture({ phased: true });
	await expect(readPlanningHandoff({ ...fixture, handoff: { ...fixture.handoff, phases: [...fixture.handoff.phases].reverse() } })).rejects.toThrow(
		'phase order changed',
	);
});

test('reports a missing original workspace without adopting another plan', async () => {
	const fixture = await planningHandoffFixture();
	await expect(readPlanningHandoff({ ...fixture, handoff: { ...fixture.handoff, name: 'missing-original' } })).rejects.toThrow(
		'Missing pinned planning generation',
	);
});

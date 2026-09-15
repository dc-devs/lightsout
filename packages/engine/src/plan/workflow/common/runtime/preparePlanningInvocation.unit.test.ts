import { expect, test } from '@jest/globals';
import { preparePlanningInvocation } from '#src/plan/workflow/common/runtime/preparePlanningInvocation.ts';
import { collectPlanningPriorArt } from '#src/plan/workflow/review/index.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';

test('acquires the real prior-art census before constructing an investigation packet without a provider call', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	fixture.runtime.services.priorArt = collectPlanningPriorArt;
	const prepared = await preparePlanningInvocation({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work, standards: fixture.standards });
	expect(prepared.snapshot.record.artifacts.some((artifact) => artifact.path.startsWith('planning-prior-art/'))).toBe(true);
	expect(prepared.snapshot.record.evidence).toContainEqual(
		expect.objectContaining({ assignmentId: fixture.work.id, conclusion: expect.stringContaining('mechanical index cannot establish semantic duplication') }),
	);
	expect(prepared.packet.prompt).toContain('mechanical index cannot establish semantic duplication');
	expect(prepared.binding.attemptId).toBe(fixture.work.currentAttemptId);
	expect(prepared.binding.packetDigest).toBe(prepared.packet.inputDigest);
	expect(fixture.calls).toHaveLength(0);
});

test('refuses replaced or unowned attempts before persisting invocation authority', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	for (const work of [
		{ ...fixture.work, id: 'unknown-work' },
		{ ...fixture.work, currentAttemptId: 'replaced-attempt' },
		{ ...fixture.work, inputDigest: 'a'.repeat(64) },
	]) {
		await expect(preparePlanningInvocation({ runtime: fixture.runtime, snapshot: fixture.snapshot, work, standards: fixture.standards })).rejects.toThrow(
			'lost its current attempt',
		);
	}
	expect(fixture.calls).toHaveLength(0);
});

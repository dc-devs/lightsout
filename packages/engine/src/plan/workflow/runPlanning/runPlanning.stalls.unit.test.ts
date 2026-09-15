import { expect, test } from '@jest/globals';
import { readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';
import { rejectPlanningLocalWrites } from '#tests/helpers/rejectPlanningLocalWrites.ts';

test('diagnoses a missing completion obligation even after every originally scheduled role has finished', async () => {
	const fixture = await planningWorkflowFixture();
	await fixture.capture();
	const first = await runPlanning({ runtime: fixture.runtime });
	if (first.status !== 'complete') throw new Error('Expected initial completed schedule');
	const before = await readPlanningSnapshot(fixture);
	const evaluate = fixture.runtime.services.evaluate;
	fixture.runtime.services.evaluate = (params) => ({ ...evaluate(params), ready: false, missingReason: 'A newly required cross-boundary check remains' });
	const calls: string[] = [];
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async (invocation) => {
			calls.push(invocation.prompt);
			return { text: 'Capacity unavailable for the new diagnosis', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanning({ runtime: fixture.runtime });
	const after = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('externally-blocked');
	expect(calls).toHaveLength(1);
	expect(calls[0]).toContain('A newly required cross-boundary check remains');
	expect(after?.record.work.find((work) => work.id.startsWith('stall:'))).toEqual(expect.objectContaining({ role: 'diagnose', status: 'interrupted' }));
	expect(after?.record.reviewReceipts).toStrictEqual(before?.record.reviewReceipts);
	for (const work of before?.record.work ?? []) expect(after?.record.work.find((item) => item.id === work.id)).toStrictEqual(work);
});

test('returns a persistence blocker from an actively dispatched role without retiring its owned paid output', async () => {
	const fixture = await planningWorkflowFixture();
	const fault = await rejectPlanningLocalWrites(fixture);
	await fixture.capture();
	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);
	expect(result).toEqual(expect.objectContaining({ status: 'externally-blocked', cause: expect.stringContaining('persistence') }));
	expect(fixture.calls).toHaveLength(1);
	expect(fixture.runtime.pendingOutput?.workId).toBe('initial:investigate');
	expect(snapshot?.record.work.find((work) => work.id === 'initial:investigate')).toEqual(expect.objectContaining({ status: 'running', failureIds: [] }));
	expect(snapshot?.record.work.find((work) => work.id === 'initial:investigate')?.resultReceiptId).toBeUndefined();
	await fault.restore();
	const resumed = await runPlanning({ runtime: fixture.runtime });
	expect(resumed.status).toBe('complete');
	expect(fixture.calls.filter((call) => call.prompt.includes('"role":"investigate"'))).toHaveLength(1);
});

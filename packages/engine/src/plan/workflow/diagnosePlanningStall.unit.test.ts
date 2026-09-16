import { expect, test } from '@jest/globals';
import { diagnosePlanningStall, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningRecoveryScenario } from '#tests/helpers/planningWorkflowScenarios.ts';

const setup = async () => {
	const fixture = await planningRecoveryScenario();
	await fixture.capture();
	const paused = await runPlanning({ runtime: fixture.runtime });
	if (paused.status !== 'externally-blocked') throw new Error('Expected real quota interruption');
	const snapshot = await readPlanningSnapshot(fixture);
	if (!snapshot) throw new Error('Missing interrupted snapshot');
	const failed = snapshot.record.work.find((work) => work.status === 'interrupted');
	if (!failed) throw new Error('Missing actual interrupted work');
	return { ...fixture, snapshot, failedWorkIds: [failed.id], beforeCalls: fixture.calls.length };
};

test('claims diagnosis independently and returns a proposal without granting readiness', async () => {
	const fixture = await setup();

	const result = await diagnosePlanningStall(fixture);
	const after = await readPlanningSnapshot(fixture);

	expect(result).toEqual(expect.objectContaining({ kind: 'terminal', role: 'diagnose', diagnosis: expect.stringContaining('preserved observations') }));
	expect(fixture.calls).toHaveLength(fixture.beforeCalls + 1);
	expect(after?.record.work.find((work) => work.id === result.workId)).toEqual(
		expect.objectContaining({ status: 'running', currentAttemptId: result.attemptId }),
	);
	expect(after?.record.reviewReceipts).toStrictEqual(fixture.snapshot.record.reviewReceipts);
});

test('refuses nonexistent failure references before invoking a diagnostic provider', async () => {
	const fixture = await setup();

	await expect(diagnosePlanningStall({ ...fixture, failedWorkIds: ['invented-work'] })).rejects.toThrow(/existing failed work/);

	expect(fixture.calls).toHaveLength(fixture.beforeCalls);
});

test('does not dispatch a second diagnosis while the original claimed attempt remains healthy', async () => {
	const fixture = await setup();
	await diagnosePlanningStall(fixture);
	const snapshot = await readPlanningSnapshot(fixture);
	if (!snapshot) throw new Error('Claimed diagnosis snapshot is absent');
	const calls = fixture.calls.length;

	await expect(diagnosePlanningStall({ ...fixture, snapshot })).rejects.toThrow(/Another owner/);

	expect(fixture.calls).toHaveLength(calls);
});

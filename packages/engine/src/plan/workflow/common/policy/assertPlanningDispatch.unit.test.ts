import { expect, test } from '@jest/globals';
import { assertPlanningDispatch } from '#src/plan/workflow/common/policy/assertPlanningDispatch.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';

const setup = async () => {
	const fixture = await planningClaimedWorkflowFixture();
	return { ...fixture, driver: fixture.runtime.driver };
};

test.each(['provider', 'stage', 'missing-generation', 'unowned', 'attempt', 'input'])(
	'refuses stale planning dispatch without invoking a provider: %s',
	async (defect) => {
		const fixture = await setup();
		if (defect === 'provider') fixture.driver = { ...fixture.driver };
		if (defect === 'stage') fixture.work = { ...fixture.work, stage: 'brainstorm' };
		if (defect === 'missing-generation') fixture.runtime.cwd = await freshCwd();
		if (defect === 'unowned') fixture.work = { ...fixture.work, id: 'missing' };
		if (defect === 'attempt') fixture.work = { ...fixture.work, currentAttemptId: 'different' };
		if (defect === 'input') fixture.work = { ...fixture.work, inputDigest: 'a'.repeat(64) };
		await expect(assertPlanningDispatch(fixture)).rejects.toThrow(/provider or stage|disappeared|active attempt/);
		expect(fixture.calls).toStrictEqual([]);
	},
);

import { describe, expect, test } from '@jest/globals';
import { planDraftCommand } from '#src/cli/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setup = async () => {
	const fixture = await planningWorkflowFixture();
	return {
		...fixture,
		params: {
			...fixture,
			driver: fixture.runtime.driver,
			config: fixture.runtime.config,
			standards: undefined,
			flags: new Map<string, string | true>([['legacy', true]]),
		},
	};
};

describe('planDraftCommand', () => {
	test('refuses the retired legacy selector before invoking a provider or creating a planning attempt', async () => {
		const fixture = await setup();

		const run = planDraftCommand(fixture.params);

		await expect(run).rejects.toThrow('no longer selects an authoring engine');
		expect(fixture.calls).toEqual([]);
	});
});

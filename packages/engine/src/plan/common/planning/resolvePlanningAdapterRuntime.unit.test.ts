import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolvePlanningAdapterRuntime } from '#src/plan/common/planning/resolvePlanningAdapterRuntime.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setup = async () => {
	const fixture = await planningWorkflowFixture();
	await fixture.capture();
	await writeFile(join(fixture.cwd, 'lightsout.config.json'), JSON.stringify(fixture.runtime.config));
	return { ...fixture, driver: fixture.runtime.driver };
};

test.each([false, true])('canonical grade adapters honor scoped overrides without mutating persistent configuration: %s', async (override) => {
	const fixture = await setup();
	const runtime = await resolvePlanningAdapterRuntime({ ...fixture, ...(override ? { model: 'claude-opus-4-6', effort: 'high' } : {}) });
	expect(runtime?.stage).toBe('implementation');
	expect(runtime?.mode).toBe('interactive');
	if (override) {
		expect(runtime?.model).toBe('claude-opus-4-6');
		expect(runtime?.effort).toBe('high');
	}
	expect(fixture.calls).toStrictEqual([]);
});

import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
// Dependencies
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { createPlanningRuntime, ensurePlanningInput, resolveBrainstormGeneration } from '#src/plan/index.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const setup = async ({ handoff = false }: { handoff?: boolean } = {}) => {
	const fixture = await planningAlignedFixture();
	if (handoff) {
		const runtime = await createPlanningRuntime({
			...fixture,
			driver: fixture.runtime.driver,
			config: fixture.runtime.config,
			mode: fixture.runtime.mode,
			stage: PlanningVocabulary.Stage.Implementation,
		});
		await ensurePlanningInput({ runtime });
	}
	return { ...fixture, params: { cwd: fixture.cwd, name: fixture.name, config: fixture.runtime.config } };
};

describe('resolveBrainstormGeneration', () => {
	test('resolves one completed challenged design without rereading mutable notes', async () => {
		const fixture = await setup();

		const resolved = await resolveBrainstormGeneration(fixture.params);

		expect(resolved?.generation).toBe(fixture.snapshot.digest);
		expect(resolved?.files).toEqual(fixture.files);
	});

	test('retains the exact aligned generation after implementation policy and work are added', async () => {
		const fixture = await setup({ handoff: true });

		const resolved = await resolveBrainstormGeneration(fixture.params);

		expect(resolved?.generation).toBe(fixture.snapshot.digest);
		expect(resolved?.files).toEqual(fixture.files);
		expect((await fixture.current()).record.work.some((work) => work.stage === PlanningVocabulary.Stage.Implementation)).toBe(true);
	});
});

test('returns no brainstorm generation for a workspace with no canonical input', async () => {
	const cwd = setupConsumerRepo();
	expect(await resolveBrainstormGeneration({ cwd, name: 'missing', config: await readConfig({ cwd }) })).toBeUndefined();
});

test('refuses unfinished brainstorm authority rather than publishing legacy notes', async () => {
	const fixture = await planningAlignedFixture({ approved: false });
	await expect(resolveBrainstormGeneration({ cwd: fixture.cwd, name: fixture.name, config: fixture.runtime.config })).rejects.toThrow('not ready');
});

test('returns no brainstorm for implementation-only planning', async () => {
	const fixture = await planningHandoffFixture();
	expect(await resolveBrainstormGeneration({ cwd: fixture.cwd, name: fixture.name, config: fixture.config })).toBeUndefined();
});

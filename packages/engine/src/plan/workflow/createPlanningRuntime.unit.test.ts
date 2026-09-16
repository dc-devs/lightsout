import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { createPlanningRuntime } from '#src/plan/workflow/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async ({ stage = PlanningVocabulary.Stage.Implementation }: { stage?: PlanningWork['stage'] } = {}) => {
	const fixture = await planningReviewFixture({ stage });
	const config = {
		...fixture.runtime.config,
		model: 'global-model',
		'auto-plan': { 'auto-approve-plan': true },
		effort: 'low' as const,
		commands: { plan: { model: 'selected-plan-model', effort: 'high' as const } },
	};
	const runtime = await createPlanningRuntime({ ...fixture, driver: fixture.runtime.driver, config, mode: fixture.runtime.mode, stage });
	Object.assign(fixture.runtime, runtime);
	return { ...fixture, config };
};

describe('createPlanningRuntime', () => {
	test('runs the composed planner with configured execution and real readiness checks', async () => {
		const fixture = await setup();
		fixture.config.commands.plan.model = 'changed-outside-runtime';

		const result = await fixture.run();

		expect(result.status).toBe('complete');
		expect(fixture.calls.length).toBeGreaterThan(0);
		expect(fixture.calls.every((call) => call.model === 'selected-plan-model' && call.effort === 'high')).toBe(true);
		const snapshot = await fixture.current();
		expect(snapshot.record.executionPolicies).toHaveLength(1);
		expect(snapshot.record.reviewReceipts.some((receipt) => receipt.role === 'integration-review')).toBe(true);
	});

	test('keeps brainstorm alignment a foreground decision instead of reporting implementation readiness', async () => {
		const fixture = await setup({ stage: PlanningVocabulary.Stage.Brainstorm });

		const result = await fixture.run();

		expect(result.status).toBe('awaiting-user');
		expect(fixture.calls.some((call) => call.prompt.includes('"role":"design-review"'))).toBe(true);
		expect(fixture.calls.some((call) => call.prompt.includes('"role":"draft"'))).toBe(false);
	});

	test('rejects unsupported harness controls before any provider invocation', async () => {
		const fixture = await planningReviewFixture();

		const create = createPlanningRuntime({
			...fixture,
			driver: { ...fixture.runtime.driver, name: 'codex' },
			config: { ...fixture.runtime.config, harness: 'codex' },
			mode: fixture.runtime.mode,
			stage: fixture.runtime.stage,
		});

		await expect(create).rejects.toThrow('cannot provide required planning controls');
		expect(fixture.calls).toEqual([]);
	});
});

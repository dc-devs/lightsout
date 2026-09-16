import { describe, expect, test } from '@jest/globals';

// Dependencies
import { PlanVariant } from '#src/contracts/index.ts';
import { capturePlanningLayout } from '#src/plan/index.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setup = async ({ changed = false, initial = true, race = false }: { changed?: boolean; initial?: boolean; race?: boolean } = {}) => {
	const fixture = await planningWorkflowFixture();
	await fixture.capture();
	if (initial) await capturePlanningLayout({ runtime: fixture.runtime, scope: PlanVariant.Single });
	if (changed) await capturePlanningLayout({ runtime: fixture.runtime, scope: PlanVariant.Overview });
	const before = await readPlanningSnapshot(fixture);
	if (race) {
		let arrivals = 0;
		let release: (() => void) | undefined;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		fixture.runtime.storeIO = {
			checkpoint: async ({ operation }) => {
				if (operation !== 'candidate') return;
				arrivals += 1;
				if (arrivals === 2) release?.();
				await barrier;
			},
		};
	}
	return { ...fixture, before };
};

describe('capturePlanningLayout', () => {
	test('records renewed layout approval after single to phased to single while preserving predecessors', async () => {
		const fixture = await setup({ changed: true });

		await capturePlanningLayout({ runtime: fixture.runtime, scope: PlanVariant.Single });

		const snapshot = await readPlanningSnapshot(fixture);
		const claims = snapshot?.record.claims.filter((claim) => claim.id.startsWith('cli-layout:'));
		expect(claims?.map((claim) => ({ text: claim.text, state: claim.state }))).toEqual([
			{ text: '--scope single', state: 'superseded' },
			{ text: '--scope phased', state: 'superseded' },
			{ text: '--scope single', state: 'settled' },
		]);
		expect(claims?.[2].supersedes).toBe(claims?.[1].id);
		expect(new Set(claims?.map((claim) => claim.confirmationId)).size).toBe(3);
	});

	test('retains the generation when the current layout is explicitly selected again', async () => {
		const fixture = await setup();

		await capturePlanningLayout({ runtime: fixture.runtime, scope: PlanVariant.Single });

		expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before?.digest);
	});
	test('allows only one current layout when first foreground choices race', async () => {
		const fixture = await setup({ initial: false, race: true });

		const choices = await Promise.allSettled(
			[PlanVariant.Single, PlanVariant.Overview].map((scope) => capturePlanningLayout({ runtime: fixture.runtime, scope })),
		);

		const snapshot = await readPlanningSnapshot(fixture);
		const current = snapshot?.record.claims.filter((claim) => claim.id.startsWith('cli-layout:') && claim.state === 'settled');
		expect(current).toHaveLength(1);
		expect(choices.filter((choice) => choice.status === 'fulfilled')).toHaveLength(1);
		expect(choices.filter((choice) => choice.status === 'rejected')).toHaveLength(1);
	});
});

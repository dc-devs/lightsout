import { describe, expect, test } from '@jest/globals';
import { PlanVariant } from '@/contracts';
import { planDraftOutputs } from '@/plan/common/paths/planDraftOutputs';

describe('planDraftOutputs', () => {
	test("a single plan is one plan.md inside the plan's own folder", () => {
		const outputs = planDraftOutputs({ cwd: '/repo', name: 'add-search', variant: PlanVariant.Single });

		expect(outputs).toStrictEqual([{ path: '/repo/.lightsout/plans/add-search/plan.md', variant: PlanVariant.Single }]);
	});

	test('a phased plan gets its own folder fronted by an overview', () => {
		const outputs = planDraftOutputs({ cwd: '/repo', name: 'add-search', variant: PlanVariant.Overview });

		// only the entry file is dictated — the agent chooses the phase breakdown
		expect(outputs).toStrictEqual([{ path: '/repo/.lightsout/plans/add-search/overview.md', variant: PlanVariant.Overview }]);
	});
});

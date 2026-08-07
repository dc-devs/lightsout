import { expect, describe, test } from '@jest/globals';
import { PlanVariant } from '@/contracts';
import { planDraftOutputs } from '@/plan/common/paths/planDraftOutputs';

describe('planDraftOutputs', () => {
	test('a single plan is one file named for the plan, written into the plans directory', () => {
		const { outputs, dir } = planDraftOutputs({ plansDir: '/repo/.claude/plans', name: 'add-search', variant: PlanVariant.Single });

		expect(outputs).toStrictEqual([{ path: '/repo/.claude/plans/add-search.md', variant: PlanVariant.Single }]);
		expect(dir).toBe('/repo/.claude/plans');
	});

	test('a phased plan gets its own folder fronted by an overview', () => {
		const { outputs, dir } = planDraftOutputs({ plansDir: '/repo/.claude/plans', name: 'add-search', variant: PlanVariant.Overview });

		// only the entry file is dictated — the agent chooses the phase breakdown
		expect(outputs).toStrictEqual([{ path: '/repo/.claude/plans/add-search/overview.md', variant: PlanVariant.Overview }]);
		expect(dir).toBe('/repo/.claude/plans/add-search');
	});
});

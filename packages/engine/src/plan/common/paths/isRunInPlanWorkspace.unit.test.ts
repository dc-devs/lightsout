import { describe, expect, test } from '@jest/globals';
import { isRunInPlanWorkspace } from '#src/plan/common/paths/isRunInPlanWorkspace.ts';

const setupRunPlans = () => [
	{ runPlan: '.lightsout/plans/lo-7/plan.md', name: 'lo-7' },
	{ runPlan: '.lightsout/plans/lo-7/002-x/phase1-a.md', name: 'lo-7/002-x' },
	{ runPlan: '.claude/plans/lo-7/overview.md', name: 'lo-7' },
	{ runPlan: '.lightsout/plans/lo-70/plan.md', name: 'lo-7' },
	{ runPlan: '.lightsout/plans/lo-7/001-a/plan.md', name: 'lo-7/002-x' },
	{ runPlan: '.claude/plans/lo-70/plan.md', name: 'lo-7' },
	{ runPlan: '.lightsout/plans/lo-7', name: 'lo-7' },
];

describe('isRunInPlanWorkspace', () => {
	test('matches a run to a plan folder by either plans prefix and never to a sibling sharing its leading text', () => {
		const runPlans = setupRunPlans();

		const matches = runPlans.map(({ runPlan, name }) => ({ runPlan, name, matched: isRunInPlanWorkspace({ runPlan, name }) }));

		expect(matches).toStrictEqual([
			{ runPlan: '.lightsout/plans/lo-7/plan.md', name: 'lo-7', matched: true },
			{ runPlan: '.lightsout/plans/lo-7/002-x/phase1-a.md', name: 'lo-7/002-x', matched: true },
			{ runPlan: '.claude/plans/lo-7/overview.md', name: 'lo-7', matched: true },
			{ runPlan: '.lightsout/plans/lo-70/plan.md', name: 'lo-7', matched: false },
			{ runPlan: '.lightsout/plans/lo-7/001-a/plan.md', name: 'lo-7/002-x', matched: false },
			{ runPlan: '.claude/plans/lo-70/plan.md', name: 'lo-7', matched: false },
			{ runPlan: '.lightsout/plans/lo-7', name: 'lo-7', matched: false },
		]);
	});
});

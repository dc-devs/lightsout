import { expect, test } from '@jest/globals';
import { type RunListing, RunStatus } from '#src/contracts/index.ts';
import { matchPlanRuns } from '#src/views/common/utils/matchPlanRuns.ts';

/** One runs-list row, filled in as the engine fills it, with only the plan path and the id a case cares about stated. */
const runNaming = ({ plan, runId = plan }: { plan: string; runId?: string }): RunListing => ({
	runId,
	shortId: runId.slice(0, 8),
	pipeline: 'implement',
	status: RunStatus.Passed,
	title: 'a run',
	plan,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	live: false,
	packages: [],
	stepsPassed: 0,
	stepCount: 0,
	changedFileCount: 0,
	resumable: false,
});

test('a phased plan keeps every run inside its folder, coordinator and phases alike', () => {
	const runs = [
		runNaming({ plan: '.lightsout/plans/add-search/overview.md' }),
		runNaming({ plan: '.lightsout/plans/add-search/phase2-indexing.md' }),
		runNaming({ plan: '.lightsout/plans/add-search/phase1-schema.md' }),
	];

	// an exact match on one file would show one of these three
	expect(matchPlanRuns({ name: 'add-search', runs }).map((run) => run.plan)).toStrictEqual(runs.map((run) => run.plan));
});

test('a run planned in the legacy .claude/plans folder still belongs to its workspace', () => {
	const runs = [runNaming({ plan: '.claude/plans/add-search/plan.md' })];

	expect(matchPlanRuns({ name: 'add-search', runs })).toHaveLength(1);
});

test('a workspace whose name is a prefix of another does not steal its runs', () => {
	const runs = [runNaming({ plan: '.lightsout/plans/add-search-v2/plan.md' })];

	// the separator is part of the prefix, which is what keeps 'add-search' out of 'add-search-v2'
	expect(matchPlanRuns({ name: 'add-search', runs })).toStrictEqual([]);
});

test('a plan path that names the folder and no file inside it belongs to no workspace', () => {
	const runs = [runNaming({ plan: '.lightsout/plans/add-search' })];

	expect(matchPlanRuns({ name: 'add-search', runs })).toStrictEqual([]);
});

test('the runs come back in the order they were given, which is the newest-first order listRuns already produced', () => {
	const runs = [
		runNaming({ plan: '.lightsout/plans/add-search/phase3-ui.md', runId: 'newest' }),
		runNaming({ plan: '.lightsout/plans/other/plan.md', runId: 'unrelated' }),
		runNaming({ plan: '.lightsout/plans/add-search/phase1-schema.md', runId: 'oldest' }),
	];

	expect(matchPlanRuns({ name: 'add-search', runs }).map((run) => run.runId)).toStrictEqual(['newest', 'oldest']);
});

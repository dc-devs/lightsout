import { expect, test } from '@jest/globals';
import { type RunListing, RunStatus } from '#src/contracts/index.ts';
import { matchPlanRuns } from '#src/views/common/utils/matchPlanRuns.ts';

/** One runs-list row as the engine fills it, stating the plan name the run recorded alongside the plan path, which the match no longer reads. */
const runRecording = ({ planName, plan, runId = plan }: { planName?: string; plan: string; runId?: string }): RunListing => ({
	runId,
	shortId: runId.slice(0, 8),
	pipeline: 'implement',
	status: RunStatus.Passed,
	title: 'a run',
	plan,
	planName,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	live: false,
	packages: [],
	stepsPassed: 0,
	stepCount: 0,
	changedFileCount: 0,
	resumable: false,
});

test('a plan keeps the runs that recorded its name, and no others', () => {
	const runs = [
		runRecording({ planName: 'add-search/001-indexing', plan: 'somewhere/else/overview.md', runId: 'recorded-this-plan' }),
		runRecording({ planName: 'add-search/001-indexing-v2', plan: '.lightsout/tickets/add-search/plans/001-indexing/plan.md', runId: 'recorded-a-near-name' }),
		runRecording({ planName: undefined, plan: '.lightsout/tickets/add-search/plans/001-indexing/plan.md', runId: 'recorded-no-plan' }),
	];

	const matched = matchPlanRuns({ name: 'add-search/001-indexing', runs });

	// the plan paths are chosen to answer the opposite way from the recorded names, so only the recorded name can produce this
	expect(matched.map((run) => run.runId)).toStrictEqual(['recorded-this-plan']);
});

test('the matched runs keep the newest-first order they were given', () => {
	const runs = [
		runRecording({ planName: 'add-search/001-indexing', plan: '.lightsout/tickets/add-search/plans/001-indexing/phase3-ui.md', runId: 'newest' }),
		runRecording({ planName: 'add-search/002-ranking', plan: '.lightsout/tickets/add-search/plans/002-ranking/plan.md', runId: 'unrelated' }),
		runRecording({ planName: 'add-search/001-indexing', plan: '.lightsout/tickets/add-search/plans/001-indexing/phase1-schema.md', runId: 'oldest' }),
	];

	const matched = matchPlanRuns({ name: 'add-search/001-indexing', runs });

	expect(matched.map((run) => run.runId)).toStrictEqual(['newest', 'oldest']);
});

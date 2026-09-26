import { describe, expect, test } from '@jest/globals';
import { groupRunFamilies } from '#src/cli/internal/common/runFamily/groupRunFamilies.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { RunListing } from '#src/contracts/views/RunListing.ts';

/** One runs-list row carrying what the grouping reads — the run's own id, and the coordinator it names when it is a phase child. */
const runListing = ({ runId, parentRunId }: { runId: string; parentRunId?: string }): RunListing => ({
	runId,
	shortId: runId.slice(0, 8),
	pipeline: 'implement',
	status: RunStatus.Running,
	title: 'a run',
	plan: 'plans/demo/plan.md',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	live: false,
	packages: [],
	stepsPassed: 0,
	stepCount: 0,
	changedFileCount: 0,
	parentRunId,
	resumable: false,
});

/** Each family as its root and the run ids it holds, ordered by root — which family is answered first is not part of the contract, but the order inside one is. */
const rootsAndIds = ({ families }: { families: ReturnType<typeof groupRunFamilies> }) =>
	[...families].sort((first, second) => first.root.localeCompare(second.root)).map(({ root, runs }) => ({ root, runIds: runs.map((run) => run.runId) }));

describe('groupRunFamilies', () => {
	test('groups a coordinator with the phase children that name it, and leaves an unrelated run a family of its own', () => {
		const runs = [
			runListing({ runId: 'run-coordinator' }),
			runListing({ runId: 'run-phase-one', parentRunId: 'run-coordinator' }),
			runListing({ runId: 'run-unrelated' }),
			runListing({ runId: 'run-phase-two', parentRunId: 'run-coordinator' }),
		];

		const families = groupRunFamilies({ runs });

		expect(rootsAndIds({ families })).toStrictEqual([
			{ root: 'run-coordinator', runIds: ['run-coordinator', 'run-phase-one', 'run-phase-two'] },
			{ root: 'run-unrelated', runIds: ['run-unrelated'] },
		]);
	});

	test("keeps each family's runs in the order the listing answered them", () => {
		// the coordinator sits between its children, so only the input order can produce the order asserted below
		const runs = [
			runListing({ runId: 'child-updated-last', parentRunId: 'run-coordinator' }),
			runListing({ runId: 'run-coordinator' }),
			runListing({ runId: 'child-updated-first', parentRunId: 'run-coordinator' }),
		];

		const families = groupRunFamilies({ runs });

		expect(rootsAndIds({ families })).toStrictEqual([{ root: 'run-coordinator', runIds: ['child-updated-last', 'run-coordinator', 'child-updated-first'] }]);
	});
});

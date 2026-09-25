import { describe, expect, test } from '@jest/globals';
import { getRunFamilyRoot } from '#src/cli/common/runFamily/getRunFamilyRoot.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { RunListing } from '#src/contracts/views/RunListing.ts';

/** One runs-list row, carrying a coordinator id only when the run records one — which is what tells a phase child from a run of its own. */
const listingOf = ({ runId, parentRunId }: { runId: string; parentRunId?: string }): RunListing => ({
	runId,
	shortId: runId.slice(0, 8),
	pipeline: 'implement',
	status: RunStatus.Running,
	title: 'a run',
	plan: '.lightsout/work-orders/demo/plans/001-demo/plan.md',
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

const setupRuns = () => {
	const standalone = listingOf({ runId: 'run-with-no-coordinator' });
	const phaseChild = listingOf({ runId: 'phase-child-run', parentRunId: 'coordinator-run' });

	return { standalone, phaseChild };
};

describe('getRunFamilyRoot', () => {
	test("a run with no coordinator is its own family root, and a phase child takes its coordinator's id", () => {
		const { standalone, phaseChild } = setupRuns();

		const standaloneRoot = getRunFamilyRoot({ run: standalone });
		const phaseChildRoot = getRunFamilyRoot({ run: phaseChild });

		expect({ standaloneRoot, phaseChildRoot }).toStrictEqual({
			standaloneRoot: 'run-with-no-coordinator',
			// never 'phase-child-run': a phase child belongs to the family its coordinator heads
			phaseChildRoot: 'coordinator-run',
		});
	});
});

import { describe, expect, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { PipelineKind } from '@lightsout/engine/contracts';
import { foldPhaseChildren } from '#src/features/runs/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';

type RunName = 'coordinator' | 'firstChild' | 'secondChild' | 'standalone' | 'orphan';

/**
 * The runs a test hands over, named rather than spelled out, so each test says
 * which rows are on the table and nothing else.
 */
const setupRuns = ({ include = [] }: { include?: RunName[] } = {}) => {
	const byName: Record<RunName, RunListing> = {
		coordinator: buildRunListing({ runId: 'coordinator1', title: 'web app redesign', pipeline: PipelineKind.Phases }),
		firstChild: buildRunListing({ runId: 'child1111111', title: 'phase 1 design system', parentRunId: 'coordinator1' }),
		secondChild: buildRunListing({ runId: 'child2222222', title: 'phase 2 runs table', parentRunId: 'coordinator1' }),
		standalone: buildRunListing({ runId: 'standalone11', title: 'add search' }),
		orphan: buildRunListing({ runId: 'orphan111111', title: 'phase 9 of a deleted coordinator', parentRunId: 'deleted11111' }),
	};

	return { runs: include.map((name) => byName[name]), byName };
};

describe('foldPhaseChildren', () => {
	test('gives a run that started no phases a group of its own with nothing under it', () => {
		const { runs, byName } = setupRuns({ include: ['standalone'] });

		const groups = foldPhaseChildren({ runs });

		expect(groups).toStrictEqual([{ run: byName.standalone, children: [] }]);
	});

	test('folds a phase run under the coordinator its parent id names', () => {
		const { runs, byName } = setupRuns({ include: ['coordinator', 'firstChild'] });

		const groups = foldPhaseChildren({ runs });

		expect(groups).toStrictEqual([{ run: byName.coordinator, children: [byName.firstChild] }]);
	});

	test('keeps a folded child out of the top level, so no run is read twice', () => {
		const { runs } = setupRuns({ include: ['coordinator', 'firstChild', 'standalone'] });

		const groups = foldPhaseChildren({ runs });

		expect(groups.map((group) => group.run.title)).toStrictEqual(['web app redesign', 'add search']);
	});

	test('carries every child of one coordinator, in the order the runs were given', () => {
		const { runs } = setupRuns({ include: ['coordinator', 'secondChild', 'firstChild'] });

		const groups = foldPhaseChildren({ runs });

		expect(groups[0].children.map((child) => child.title)).toStrictEqual(['phase 2 runs table', 'phase 1 design system']);
	});

	test('folds a child listed before its coordinator, which reading in order alone would miss', () => {
		const { runs, byName } = setupRuns({ include: ['firstChild', 'coordinator'] });

		const groups = foldPhaseChildren({ runs });

		expect(groups).toStrictEqual([{ run: byName.coordinator, children: [byName.firstChild] }]);
	});

	test('promotes a child whose coordinator was deleted, so a run never becomes unreachable', () => {
		const { runs, byName } = setupRuns({ include: ['orphan'] });

		const groups = foldPhaseChildren({ runs });

		expect(groups).toStrictEqual([{ run: byName.orphan, children: [] }]);
	});

	test('promotes a child whose coordinator a filter narrowed away, beside the runs that stayed', () => {
		const { runs } = setupRuns({ include: ['standalone', 'firstChild'] });

		const groups = foldPhaseChildren({ runs });

		expect(groups.map((group) => group.run.title)).toStrictEqual(['add search', 'phase 1 design system']);
	});

	test('gives an empty list back when there is nothing to fold', () => {
		const { runs } = setupRuns();

		const groups = foldPhaseChildren({ runs });

		expect(groups).toStrictEqual([]);
	});
});

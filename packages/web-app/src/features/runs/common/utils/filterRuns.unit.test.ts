import { describe, expect, test } from '@jest/globals';
import { PipelineKind, RunStatus } from '@lightsout/engine/contracts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import { filterRuns, type RunFilters, RunsSortKey } from '#src/features/runs/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';

const runs = [
	buildRunListing({ runId: 'aaaaaaaa1111', title: 'add search', pipeline: PipelineKind.Implement, status: RunStatus.Passed }),
	buildRunListing({ runId: 'bbbbbbbb2222', title: 'Burn down sprawl', pipeline: PipelineKind.Refactor, status: RunStatus.Failed }),
	buildRunListing({ runId: 'cccccccc3333', title: 'raise coverage', pipeline: PipelineKind.Coverage, status: RunStatus.PausedBudget }),
	buildRunListing({ runId: 'dddddddd4444', title: 'web app redesign', pipeline: PipelineKind.Phases, status: RunStatus.Running }),
];

const setupFilters = ({ commands = [], statuses = [], text, sortKey, sortDirection }: Partial<RunFilters> = {}): { filters: RunFilters } => ({
	filters: { commands, statuses, text, sortKey, sortDirection },
});

/** Which runs survived, named by their titles, in the order they came back. */
const titlesOf = ({ filters }: { filters: RunFilters }) => filterRuns({ runs, filters }).map((run) => run.title);

describe('filterRuns', () => {
	test('keeps every run when nothing was narrowed', () => {
		const { filters } = setupFilters();

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['add search', 'Burn down sprawl', 'raise coverage', 'web app redesign']);
	});

	test('keeps only the runs a chosen command produced', () => {
		const { filters } = setupFilters({ commands: ['refactor'] });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['Burn down sprawl']);
	});

	test('keeps the runs of every chosen command, not just one of them', () => {
		const { filters } = setupFilters({ commands: ['implement', 'coverage'] });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['add search', 'raise coverage']);
	});

	test('tells a coordinator apart from a plain implement run, because the two are different commands', () => {
		const { filters } = setupFilters({ commands: ['implement · phased'] });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['web app redesign']);
	});

	test('keeps only the runs whose status belongs to a chosen family', () => {
		const { filters } = setupFilters({ statuses: [BadgeVariant.Paused] });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['raise coverage']);
	});

	test('keeps the runs of every chosen status family', () => {
		const { filters } = setupFilters({ statuses: [BadgeVariant.Failed, BadgeVariant.Running] });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['Burn down sprawl', 'web app redesign']);
	});

	test('reads typed text as a substring of the title rather than the whole of it', () => {
		const { filters } = setupFilters({ text: 'search' });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['add search']);
	});

	test('ignores the case a reader typed in', () => {
		const { filters } = setupFilters({ text: 'BURN' });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['Burn down sprawl']);
	});

	test('keeps nothing when the typed text matches no title', () => {
		const { filters } = setupFilters({ text: 'nothing here' });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual([]);
	});

	test('keeps only the runs that answer every filter at once', () => {
		const { filters } = setupFilters({ commands: ['implement', 'refactor'], statuses: [BadgeVariant.Failed], text: 'down' });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['Burn down sprawl']);
	});

	test('narrows only — the order a reader asked for is the table’s job, not this one’s', () => {
		const { filters } = setupFilters({ sortKey: RunsSortKey.Title, sortDirection: SortDirection.Descending });

		const titles = titlesOf({ filters });

		expect(titles).toStrictEqual(['add search', 'Burn down sprawl', 'raise coverage', 'web app redesign']);
	});
});

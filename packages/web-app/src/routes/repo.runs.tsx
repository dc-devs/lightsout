import { createFileRoute } from '@tanstack/react-router';
import { runStatusFamilies } from '#src/common/constants/runStatusFamilies.ts';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import { RunCommand, RunsPage, RunsSortKey, runsQueryOptions } from '#src/features/runs/index.ts';

/**
 * What the query string may say.
 *
 * Every key is optional, and an absent key means "do not narrow on this" — a
 * cleared filter drops out of the URL entirely, and a link to the runs page
 * that says nothing about order gets the page's own default.
 */
interface RunsSearch {
	commands?: string[];
	statuses?: string[];
	text?: string;
	sortKey?: RunsSortKey;
	sortDirection?: SortDirection;
}

/**
 * The badge families a run's status actually resolves to.
 *
 * Narrower than `BadgeVariant`, which also colours a finding's severity and the
 * brand: a URL naming one of those would pass validation and then match no run,
 * emptying the table rather than narrowing nothing. Deduplicated because the two
 * paused statuses share one family.
 */
const runStatusFamilyValues = [...new Set(Object.values(runStatusFamilies))];

/** The values from a closed vocabulary a URL list actually named — anything else narrows nothing rather than matching no run at all. */
const readList = <Option extends string>({ value, options }: { value: unknown; options: readonly Option[] }) => {
	const named = Array.isArray(value) ? value : [value];
	const kept = options.filter((option) => named.includes(option));

	return kept.length === 0 ? undefined : kept;
};

/** A free-text URL value, with an empty string read as absent so a cleared box leaves no key behind. */
const readText = ({ value }: { value: unknown }) => (typeof value === 'string' && value !== '' ? value : undefined);

/** A URL value from a closed vocabulary, or nothing — a key naming a column the table cannot order by falls back to the page's own default. */
const readOption = <Option extends string>({ value, options }: { value: unknown; options: readonly Option[] }) => options.find((option) => option === value);

const validateSearch = (search: Record<string, unknown>): RunsSearch => ({
	commands: readList({ value: search.commands, options: Object.values(RunCommand) }),
	statuses: readList({ value: search.statuses, options: runStatusFamilyValues }),
	text: readText({ value: search.text }),
	sortKey: readOption({ value: search.sortKey, options: Object.values(RunsSortKey) }),
	sortDirection: readOption({ value: search.sortDirection, options: Object.values(SortDirection) }),
});

export const Route = createFileRoute('/repo/runs')({
	validateSearch,
	// Warmed before the first render, so the table is server-rendered with its
	// runs rather than arriving as a shell the client has to fill.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(runsQueryOptions());
	},
	head: () => ({ meta: [{ title: 'Runs' }] }),
	component: RunsPage,
});

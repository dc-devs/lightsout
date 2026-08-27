import type { CommandCatalogEntry } from '@lightsout/engine';
import { CommandRecordKind } from '@lightsout/engine/contracts';
import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';
import { repoRootQueryOptions } from '#src/features/app/index.ts';
import { getCommandPlans } from '#src/features/commands/common/utils/getCommandPlans.ts';
import { getCommandRuns } from '#src/features/commands/common/utils/getCommandRuns.ts';
import { CommandBurnDownStrip } from '#src/features/commands/screens/CommandDetail/components/CommandBurnDownStrip.tsx';
import { PlansTable, planWorkspacesQueryOptions } from '#src/features/plans/index.ts';
import { RunCommand, RunsTable, runsQueryOptions } from '#src/features/runs/index.ts';
import { standardsQueryOptions } from '#src/features/standards/index.ts';

/** A one-line answer for a command whose history is not a table. */
const HistoryLine = ({ children }: { children: string }) => <p className="text-muted-foreground text-sm">{children}</p>;

/**
 * This command's own runs, in the same table the runs page uses.
 *
 * The filters are fixed rather than the reader's, so there is no clear action
 * on the zero-match state and no sort keys — `RunsTable`'s own newest-first
 * default applies.
 */
const RunsHistory = ({ entry }: { entry: CommandCatalogEntry }) => {
	const { data: runs = [] } = useQuery(runsQueryOptions());
	const { filters, runIds } = getCommandRuns({ entry, runs });
	const { commands } = filters;
	const burnsDown = commands.includes(RunCommand.Refactor) || commands.includes(RunCommand.Coverage);
	// Five rows at most: each one is a separate `getRun`, so the strip names the
	// cap rather than hiding it.
	const recent = runIds.slice(0, 5);

	return commands.length === 0 ? (
		<HistoryLine>Resumed runs appear under the command they resumed.</HistoryLine>
	) : (
		<div className="flex flex-col gap-4">
			{burnsDown ? <CommandBurnDownStrip runIds={recent} coverage={commands.includes(RunCommand.Coverage)} /> : null}
			<RunsTable runs={runs} filters={filters} onSort={() => undefined} />
		</div>
	);
};

/**
 * The plan workspaces this command wrote to, in the same table the plans page
 * uses — narrowed to the ones the command actually produces, and by the same
 * helper `CommandCount` counts through.
 */
const PlansHistory = ({ entry }: { entry: CommandCatalogEntry }) => {
	const { data: plans = [] } = useQuery(planWorkspacesQueryOptions());
	const { writesNotes, listings } = getCommandPlans({ entry, plans });

	return <PlansTable listings={listings} empty={<EmptyState title={writesNotes ? 'No brainstorm notes yet.' : 'No plans drafted yet.'} />} />;
};

/** How many checks this repo has recorded, and when the last one ran. */
const SnapshotsHistory = () => {
	const { data: standards } = useQuery(standardsQueryOptions());
	const trend = standards?.trend ?? [];

	return (
		<HistoryLine>
			{trend.length === 0 || standards?.at === undefined
				? 'No standards check has run in this repo yet.'
				: `${formatCount({ count: trend.length, noun: 'snapshot' })} recorded · last ${formatRelativeTime({ at: standards.at })}.`}
		</HistoryLine>
	);
};

interface Props {
	entry: CommandCatalogEntry;
}

/**
 * What this command has actually done in the repo the app has open.
 *
 * Gated on `repoRootQueryOptions` rather than on whether a query returned rows,
 * for the reason `CommandCount` states: the public build's reader answers
 * `listRuns` with the three demo runs, and a visitor must not be shown those as
 * their own history.
 *
 * Nothing here is a new engine reader. Every number comes from a view that
 * already exists — the runs list, the standards snapshots — which is what keeps
 * one command's history from disagreeing with the page that owns it.
 */
export const CommandHistory = ({ entry }: Props) => {
	const { data: repo } = useQuery(repoRootQueryOptions());

	if (repo?.repoRoot === undefined) {
		return null;
	}

	return (
		<Card title="In this repo">
			{entry.records === CommandRecordKind.Runs ? <RunsHistory entry={entry} /> : null}
			{entry.records === CommandRecordKind.Snapshots ? <SnapshotsHistory /> : null}
			{entry.records === CommandRecordKind.Plans ? <PlansHistory entry={entry} /> : null}
			{entry.records === CommandRecordKind.Nothing ? <HistoryLine>This command records nothing.</HistoryLine> : null}
		</Card>
	);
};

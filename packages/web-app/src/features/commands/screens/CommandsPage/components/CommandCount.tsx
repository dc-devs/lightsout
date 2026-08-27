import type { CommandCatalogEntry, PlanWorkspaceListing, RunListing, StandardsView } from '@lightsout/engine';
import { CommandRecordKind } from '@lightsout/engine/contracts';
import { useQuery } from '@tanstack/react-query';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';
import { repoRootQueryOptions } from '#src/features/app/index.ts';
import { getCommandPlans } from '#src/features/commands/common/utils/getCommandPlans.ts';
import { getCommandRuns } from '#src/features/commands/common/utils/getCommandRuns.ts';
import { planWorkspacesQueryOptions } from '#src/features/plans/index.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';
import { standardsQueryOptions } from '#src/features/standards/index.ts';

/** A count and how long ago the newest of them was, or the empty state when the repo has none yet. */
const countLine = ({ count, noun, at }: { count: number; noun: string; at?: string }) =>
	count === 0 || at === undefined ? `no ${noun}s yet` : `${formatCount({ count, noun })} · last ${formatRelativeTime({ at })}`;

/** What this command's own history table would show, counted the same way it groups them. */
const summarizeRuns = ({ entry, runs }: { entry: CommandCatalogEntry; runs: RunListing[] }) => {
	const { filters, runIds, latestAt } = getCommandRuns({ entry, runs });

	return filters.commands.length === 0 ? undefined : countLine({ count: runIds.length, noun: 'run', at: latestAt });
};

/** How many checks this repo has recorded, and when the last one ran. */
const summarizeSnapshots = ({ standards }: { standards: StandardsView }) => countLine({ count: standards.trend.length, noun: 'snapshot', at: standards.at });

/** The workspaces this command's own history table lists, counted the same way it narrows them. */
const summarizePlans = ({ entry, plans }: { entry: CommandCatalogEntry; plans: PlanWorkspaceListing[] }) => {
	const { writesNotes, listings, latestAt } = getCommandPlans({ entry, plans });

	return countLine({ count: listings.length, noun: writesNotes ? 'note' : 'plan', at: latestAt });
};

interface Props {
	entry: CommandCatalogEntry;
}

/**
 * What this command has actually done in the repo the app has open — and
 * nothing at all when there is no repo.
 *
 * Gated on `repoRootQueryOptions` rather than on whether a query returned rows:
 * a public build's reader answers `listRuns` with the three demo runs, so an
 * ungated card would tell a visitor their repo had run `/implement` twice.
 *
 * Three of the four record kinds have a number to show here; a command that
 * records nothing never does.
 */
export const CommandCount = ({ entry }: Props) => {
	const { data: repo } = useQuery(repoRootQueryOptions());
	const found = repo?.repoRoot !== undefined;
	const { data: runs } = useQuery({ ...runsQueryOptions(), enabled: found && entry.records === CommandRecordKind.Runs });
	const { data: standards } = useQuery({ ...standardsQueryOptions(), enabled: found && entry.records === CommandRecordKind.Snapshots });
	const { data: plans } = useQuery({ ...planWorkspacesQueryOptions(), enabled: found && entry.records === CommandRecordKind.Plans });
	let line: string | undefined;

	if (found && runs !== undefined && entry.records === CommandRecordKind.Runs) {
		line = summarizeRuns({ entry, runs });
	}

	if (found && standards !== undefined && entry.records === CommandRecordKind.Snapshots) {
		line = summarizeSnapshots({ standards });
	}

	if (found && plans !== undefined && entry.records === CommandRecordKind.Plans) {
		line = summarizePlans({ entry, plans });
	}

	return line === undefined ? null : <p className="text-muted-foreground text-xs">{line}</p>;
};

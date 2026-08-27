import type { RunListing } from '@lightsout/engine';
import { formatCost } from '@lightsout/shared';
import { Link } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Button, CopyButton, DataTable, DataTableRow, EmptyState, MetadataTag, StatusBadge } from '#src/appUI/index.ts';
import type { SortDirection } from '#src/common/constants/SortDirection.ts';
import { statusBadgeConfig } from '#src/common/constants/statusBadgeConfig.ts';
import { TableAlignment } from '#src/common/constants/TableAlignment.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';
import { RunsSortKey } from '#src/features/runs/common/constants/RunsSortKey.ts';
import type { RunFilters } from '#src/features/runs/common/types/RunFilters.ts';
import type { RunGroup } from '#src/features/runs/common/types/RunGroup.ts';
import { filterRuns } from '#src/features/runs/common/utils/filterRuns.ts';
import { foldPhaseChildren } from '#src/features/runs/common/utils/foldPhaseChildren.ts';
import { getRunCommand } from '#src/features/runs/common/utils/getRunCommand.ts';

/** The run's title, as the way into its evidence. */
const RunLink = ({ run }: { run: RunListing }) => (
	<Link to="/repo/runs/$runId" params={{ runId: run.runId }} className="font-medium hover:underline hover:underline-offset-2">
		{run.title}
	</Link>
);

/** The packages a run was scoped to, one tag each — empty in a repo that is not a monorepo. */
const RunPackages = ({ run }: { run: RunListing }) => (
	<span className="flex flex-wrap gap-1">
		{run.packages.map((name) => (
			<MetadataTag key={name}>{name}</MetadataTag>
		))}
	</span>
);

/** The command that would pick a stopped run back up, for the reader to run themselves. */
const ResumeCommand = ({ run, disabled }: { run: RunListing; disabled: boolean }) =>
	run.resumable && !disabled ? <CopyButton value={`lightsout resume --run ${run.shortId}`} label="Copy resume" /> : null;

/** The columns, in the order a reader scans them: how it ended, what it was, what it cost, when. */
const buildColumns = ({ commandsDisabled }: { commandsDisabled: boolean }): Array<DataTableColumn<RunGroup>> => [
	{
		key: RunsSortKey.Status,
		header: 'status',
		sortValue: ({ run }) => run.status,
		render: ({ run }) => <StatusBadge status={run.status} config={statusBadgeConfig} live={run.live} />,
	},
	{ key: RunsSortKey.Title, header: 'run', sortValue: ({ run }) => run.title, render: ({ run }) => <RunLink run={run} /> },
	{
		key: RunsSortKey.Command,
		header: 'command',
		sortValue: ({ run }) => getRunCommand({ pipeline: run.pipeline }),
		render: ({ run }) => getRunCommand({ pipeline: run.pipeline }),
	},
	{ key: 'packages', header: 'packages', render: ({ run }) => <RunPackages run={run} /> },
	{
		key: RunsSortKey.Steps,
		header: 'steps',
		align: TableAlignment.Right,
		sortValue: ({ run }) => run.stepsPassed,
		render: ({ run }) => `${run.stepsPassed}/${run.stepCount}`,
	},
	{
		key: RunsSortKey.Files,
		header: 'files',
		align: TableAlignment.Right,
		sortValue: ({ run }) => run.changedFileCount,
		render: ({ run }) => run.changedFileCount,
	},
	{
		key: RunsSortKey.Cost,
		header: 'cost',
		align: TableAlignment.Right,
		sortValue: ({ run }) => run.costUsd ?? 0,
		render: ({ run }) => (run.costUsd === undefined ? '—' : formatCost({ usd: run.costUsd })),
	},
	{
		key: RunsSortKey.Updated,
		header: 'updated',
		sortValue: ({ run }) => run.updatedAt,
		render: ({ run }) => <span className="whitespace-nowrap text-muted-foreground">{formatRelativeTime({ at: run.updatedAt })}</span>,
	},
	{ key: 'resume', header: '', render: ({ run }) => <ResumeCommand run={run} disabled={commandsDisabled} /> },
];

/** A repo with no run state at all: the three commands that put some there. */
const NoRunsYet = () => (
	<EmptyState
		icon={ScrollText}
		title="No runs yet."
		description={
			<span className="flex flex-col gap-0.5">
				<span>1. Plan the work: /plan</span>
				<span>2. Hand it over: /implement</span>
				<span>3. Watch it here.</span>
			</span>
		}
	/>
);

/** Runs there are, but none the reader asked for — so the way out is widening the filters. */
const NoMatches = ({ onClearFilters }: { onClearFilters?: () => void }) => (
	<EmptyState
		title="No runs match these filters."
		action={
			onClearFilters === undefined ? undefined : (
				<Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
					Clear filters
				</Button>
			)
		}
	/>
);

interface Props {
	runs: RunListing[];
	filters: RunFilters;
	onSort: (params: { key: string; direction: SortDirection }) => void;
	/** Clears every filter. Omitted by a consumer whose filters are fixed, which drops the clear action from the zero-match state. */
	onClearFilters?: () => void;
	/** Suppresses the resumable column's copy control — set when no repo was found, since the command names a run only this machine has. */
	commandsDisabled?: boolean;
}

/**
 * Every run this repo has, narrowed to what a reader asked for, with each
 * coordinator's phase runs folded under it.
 *
 * Both empty states are chosen here rather than by the page, because this is
 * the one place holding the unfiltered rows and the filtered ones at once:
 * "no runs yet" and "no runs match" are different answers, and telling them
 * apart anywhere else would mean filtering a second time.
 */
export const RunsTable = ({ runs, filters, onSort, onClearFilters, commandsDisabled = false }: Props) => {
	const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
	const columns = buildColumns({ commandsDisabled });
	const groups = foldPhaseChildren({ runs: filterRuns({ runs, filters }) });

	return (
		<DataTable
			rows={groups}
			columns={columns}
			getRowKey={({ run }) => run.runId}
			sortKey={filters.sortKey}
			sortDirection={filters.sortDirection}
			onSort={onSort}
			expandedKeys={expandedKeys}
			onToggleExpanded={(key) => setExpandedKeys(expandedKeys.includes(key) ? expandedKeys.filter((entry) => entry !== key) : [...expandedKeys, key])}
			renderExpanded={({ children }) =>
				children.length === 0
					? null
					: children.map((child) => (
							<DataTableRow
								key={child.runId}
								row={{ run: child, children: [] }}
								columns={columns}
								hasDisclosure
								className="border-border border-l-2 bg-muted"
							/>
						))
			}
			empty={runs.length === 0 ? <NoRunsYet /> : <NoMatches onClearFilters={onClearFilters} />}
		/>
	);
};

import type { FrictionArea, FrictionRecord, RunListing } from '@lightsout/engine';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MessageSquareWarning } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, CopyButton, DataTable, EmptyState, MetadataTag, PageHeader } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';
import { countFrictionByArea } from '#src/features/friction/common/utils/countFrictionByArea.ts';
import { filterFriction } from '#src/features/friction/common/utils/filterFriction.ts';
import { frictionQueryOptions } from '#src/features/friction/queries/frictionQueryOptions.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';

/** The one command that feeds this log back into the pipeline that produced it. */
const improveCommand = 'lightsout improve --engine <path>';

/** The run an entry was recorded in, by title when this repo still has that run and by its short id when it does not. */
const RunCell = ({ record, runs }: { record: FrictionRecord; runs: RunListing[] }) => {
	const listing = runs.find((run) => run.runId === record.runId);
	const shortId = record.runId.slice(0, 8);

	return listing === undefined ? (
		<MetadataTag title={record.runId}>{shortId}</MetadataTag>
	) : (
		<Link to="/repo/runs/$runId" params={{ runId: record.runId }} className="flex min-w-0 items-center gap-2 hover:underline hover:underline-offset-2">
			<MetadataTag>{listing.shortId}</MetadataTag>
			<span className="min-w-0 truncate">{listing.title}</span>
		</Link>
	);
};

/** The columns, in the order a reader scans them: what kind of thing this was, where it happened, and what was said. */
const buildColumns = ({ runs }: { runs: RunListing[] }): Array<DataTableColumn<FrictionRecord>> => [
	{ key: 'area', header: 'area', render: (record) => <Badge>{record.area}</Badge> },
	{ key: 'kind', header: 'kind', render: (record) => <span className="text-muted-foreground">{record.kind ?? 'friction'}</span> },
	{ key: 'run', header: 'run', render: (record) => <RunCell record={record} runs={runs} /> },
	{ key: 'step', header: 'step', render: (record) => <MetadataTag>{record.step}</MetadataTag> },
	{ key: 'detail', header: 'detail', className: 'max-w-xl', render: (record) => <span className="leading-5">{record.detail}</span> },
];

/**
 * What agents reported as getting in their way, across every run this repo has.
 *
 * The run detail's own Friction tab answers "what fought this run"; this page
 * answers the question that one cannot — what keeps fighting, run after run,
 * which is the only form the signal is actionable in.
 *
 * Suspends on the log and subscribes to the runs, because the runs are needed
 * only to put a title beside a run id: a page that waited on them would stall
 * on data no filter reads.
 */
export const FrictionPage = () => {
	const { data: records } = useSuspenseQuery(frictionQueryOptions());
	const { data: runs = [] } = useQuery(runsQueryOptions());
	const [areas, setAreas] = useState<FrictionArea[]>([]);
	const [text, setText] = useState('');
	const rows = [...filterFriction({ records, areas, text })].sort((first, second) => second.at.localeCompare(first.at));

	return (
		<div className="flex flex-col gap-4 p-6">
			<PageHeader
				icon={MessageSquareWarning}
				title="Friction"
				description={`What agents reported as getting in their way · ${formatCount({ count: records.length, noun: 'entry', plural: 'entries' })}`}
			/>
			<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
				{countFrictionByArea({ records }).map(({ area, count }) => (
					<Button
						key={area}
						type="button"
						size="sm"
						variant={areas.includes(area) ? 'outline' : 'ghost'}
						aria-pressed={areas.includes(area)}
						onClick={() => setAreas(areas.includes(area) ? areas.filter((entry) => entry !== area) : [...areas, area])}
					>
						{area}
						<span className="text-muted-foreground text-xs">{count}</span>
					</Button>
				))}
				<input
					type="search"
					aria-label="Filter friction by what was reported"
					placeholder="Filter by detail"
					value={text}
					onChange={(event) => setText(event.target.value)}
					className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring"
				/>
			</div>
			<DataTable
				rows={rows}
				columns={buildColumns({ runs })}
				getRowKey={(record) => `${record.at}:${record.runId}:${record.step}:${record.detail}`}
				empty={
					records.length === 0 ? (
						<EmptyState
							icon={MessageSquareWarning}
							title="No friction on record."
							description="Agents report this as they work — it fills in as runs finish."
						/>
					) : (
						<EmptyState title="No entries match these filters." />
					)
				}
			/>
			<p className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
				Feed this back with <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{improveCommand}</code>
				<CopyButton value={improveCommand} label="Copy improve command" />
			</p>
		</div>
	);
};

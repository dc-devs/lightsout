import { TriangleAlert } from 'lucide-react';
import { Card } from '#src/appUI/index.ts';
import { groupBy } from '#src/features/runDetail/screens/RunDetail/components/common/utils/groupBy.ts';

/** The first two segments of a path — the package, then the area within it, which is the blast radius a reader reads first. */
const toFolder = ({ path }: { path: string }) => path.split('/').slice(0, 2).join('/');

interface Props {
	files: string[];
	/** Changed, but no public surface reaches them — the warning `printResult` prints too. */
	unreachable: string[];
}

/** Everything the run changed, by folder, with the unreachable files called out separately. */
export const ChangedFilesPanel = ({ files, unreachable }: Props) => (
	<Card title={`Changed files · ${files.length}`}>
		{files.length === 0 ? (
			<p className="text-muted-foreground text-sm">This run changed nothing.</p>
		) : (
			<div className="flex flex-col gap-4">
				{groupBy({ items: files, getKey: (path) => toFolder({ path }) }).map(([folder, paths]) => (
					<div key={folder} className="flex flex-col gap-1">
						<span className="font-medium font-mono text-sm">{folder}</span>
						<ul className="flex flex-col gap-0.5 pl-3 font-mono text-muted-foreground text-xs">
							{paths.map((path) => (
								<li key={path}>{path}</li>
							))}
						</ul>
					</div>
				))}
			</div>
		)}
		{unreachable.length === 0 ? null : (
			<div className="mt-4 flex flex-col gap-1 rounded-md border border-status-running-border bg-status-running-light px-3 py-2">
				<span className="flex items-center gap-1.5 font-medium text-status-running text-xs">
					<TriangleAlert className="size-3.5" />
					unreachable — changed, but no public surface reaches them, so no test covers them
				</span>
				<ul className="flex flex-col gap-0.5 font-mono text-muted-foreground-strong text-xs">
					{unreachable.map((path) => (
						<li key={path}>{path}</li>
					))}
				</ul>
			</div>
		)}
	</Card>
);

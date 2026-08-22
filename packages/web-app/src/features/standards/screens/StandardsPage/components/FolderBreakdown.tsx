import type { StandardsFinding } from '@lightsout/engine';
import { useState } from 'react';
import { Button } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { groupFindingsByFolder } from '#src/features/standards/common/utils/groupFindingsByFolder.ts';

/** The depths the dial offers. Three is where this repo's packages sit; four separates the folders inside one package's src. */
const depths = [3, 4];

interface Props {
	/** The findings the page is currently showing, so the breakdown answers 'and where is it?' for the open filter. */
	findings: StandardsFinding[];
}

/**
 * Where the open findings actually sit, as a bar per folder.
 *
 * The single most useful thing a reader learns from a standards report is that
 * most of the debt is in one place, and a flat list of findings hides that. The
 * depth dial is here rather than in the grouping because it is a presentation
 * choice: three segments reaches a package, four reaches a folder inside one,
 * and which is the right answer depends on the repo looking.
 */
export const FolderBreakdown = ({ findings }: Props) => {
	const [depth, setDepth] = useState(4);
	const groups = groupFindingsByFolder({ findings, depth });
	const largest = groups.length === 0 ? 0 : groups[0].count;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-muted-foreground text-xs">
				<span>folder depth</span>
				{depths.map((option) => (
					<Button
						key={option}
						type="button"
						variant={option === depth ? 'outline' : 'ghost'}
						size="sm"
						aria-pressed={option === depth}
						onClick={() => setDepth(option)}
					>
						{option}
					</Button>
				))}
			</div>
			{groups.length === 0 ? (
				<p className="text-muted-foreground text-sm">No findings to place.</p>
			) : (
				groups.map((group) => (
					<details key={group.folder} className="rounded-md border border-border px-3 py-2">
						<summary className="flex cursor-pointer flex-col gap-1">
							<span className="flex items-center justify-between gap-3 text-xs">
								<span className="min-w-0 truncate font-mono">{group.folder}</span>
								<span className="text-muted-foreground">{group.count}</span>
							</span>
							{/* The width is a share of the largest bucket, so it can only be a computed style. */}
							<span aria-hidden="true" className="block h-1.5 rounded-full bg-muted">
								<span className="block h-1.5 rounded-full bg-status-failed" style={{ width: `${(group.count / largest) * 100}%` }} />
							</span>
						</summary>
						<ul className="mt-2 flex flex-col gap-0.5 text-xs">
							{group.rules.map(({ rule, count }) => (
								<li key={rule} className="flex items-center justify-between gap-3">
									<span className="min-w-0 truncate font-mono text-muted-foreground">{rule}</span>
									<span className="text-muted-foreground">{formatCount({ count, noun: 'finding' })}</span>
								</li>
							))}
						</ul>
					</details>
				))
			)}
		</div>
	);
};

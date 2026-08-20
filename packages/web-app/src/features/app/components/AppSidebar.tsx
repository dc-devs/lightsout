import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { Suspense } from 'react';
import { Separator } from '#src/common/components/ui/Separator.tsx';
import { Skeleton } from '#src/common/components/ui/Skeleton.tsx';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';
import { RunList } from '#src/features/runs/index.ts';

/**
 * The left pane: which repo is open, a way into the standards tab, and the
 * runs list under it.
 *
 * The repo root is shown here and nowhere else — it is the only place a reader
 * can tell which repo `LIGHTSOUT_REPO` pointed the server at.
 */
export const AppSidebar = () => {
	const {
		data: { repoRoot },
	} = useSuspenseQuery(repoRootQueryOptions());

	return (
		<aside className="flex w-80 shrink-0 flex-col gap-3 border-sidebar-border border-r bg-sidebar p-3">
			<header className="flex flex-col gap-1 px-3 pt-2">
				<span className="font-semibold text-base">lightsout</span>
				<span className="truncate font-mono text-muted-foreground text-xs" title={repoRoot}>
					{repoRoot}
				</span>
			</header>
			<Link
				to="/standards"
				className="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
				activeProps={{ className: 'bg-sidebar-accent-selected' }}
			>
				<ScrollText className="size-4" />
				Standards
			</Link>
			<Separator />
			<nav aria-label="Runs" className="min-h-0 flex-1 overflow-y-auto">
				<Suspense
					fallback={
						<div className="flex flex-col gap-2 px-3">
							<Skeleton className="h-12" />
							<Skeleton className="h-12" />
							<Skeleton className="h-12" />
						</div>
					}
				>
					<RunList />
				</Suspense>
			</nav>
		</aside>
	);
};

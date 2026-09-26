import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity, FileCog, MessageSquareWarning, NotebookPen, ScrollText, SquareCheckBig } from 'lucide-react';
import { MetadataTag } from '#src/appUI/badges/MetadataTag.tsx';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';

const zoneLinkClasses = 'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent';
const zoneLinkActive = { className: 'bg-sidebar-accent-selected' };

/**
 * The way into the pages that read this machine's repo, headed by the path of
 * the repo they read.
 *
 * Suspends on the repo root rather than subscribing: `/app` only exists on a
 * local server with a repo under it, and its route has the root in the cache
 * before any child renders, so there is no absent or pending case to draw.
 *
 * A column beside the page on a wide screen, a strip under the site bar on a
 * narrow one, so the page itself always keeps the full width.
 */
export const ZoneNav = () => {
	const {
		data: { repoRoot },
	} = useSuspenseQuery(repoRootQueryOptions());

	return (
		<aside className="flex w-full shrink-0 flex-col gap-3 border-border border-b bg-sidebar p-3 lg:w-56 lg:border-r lg:border-b-0">
			<header className="flex min-w-0 flex-col gap-1 px-1">
				<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Your repo</span>
				<MetadataTag className="min-w-0 truncate" title={repoRoot}>
					{repoRoot}
				</MetadataTag>
			</header>
			<nav aria-label="Your repo" className="flex min-w-0 gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
				<Link to="/app" className={zoneLinkClasses} activeProps={zoneLinkActive} activeOptions={{ exact: true }}>
					<Activity aria-hidden="true" className="size-4" />
					Health
				</Link>
				<Link to="/app/runs" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<ScrollText aria-hidden="true" className="size-4" />
					Runs
				</Link>
				<Link to="/app/plans" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<NotebookPen aria-hidden="true" className="size-4" />
					Plans
				</Link>
				<Link to="/app/standards" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<SquareCheckBig aria-hidden="true" className="size-4" />
					Standards
				</Link>
				<Link to="/app/friction" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<MessageSquareWarning aria-hidden="true" className="size-4" />
					Friction
				</Link>
				<Link to="/app/config" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<FileCog aria-hidden="true" className="size-4" />
					Config
				</Link>
			</nav>
		</aside>
	);
};

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity, FileCog, MessageSquareWarning, NotebookPen, ScrollText, SquareCheckBig } from 'lucide-react';
import { MetadataTag } from '#src/appUI/index.ts';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';

const zoneLinkClasses = 'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent';
const zoneLinkActive = { className: 'bg-sidebar-accent-selected' };

/**
 * The way into the pages that read this machine's repo, and nothing at all when
 * no repo was found.
 *
 * That absent case is what makes the public build work: a deployment with no
 * `lightsout.config.json` above it renders a site with no "Your repo" zone
 * rather than a zone whose every page is empty.
 *
 * Subscribes rather than suspends — a repo lookup that fails must not take the
 * whole shell down with it, since every sell-zone page is readable without one.
 *
 * A column beside the page on a wide screen, a strip under the site bar on a
 * narrow one, so the page itself always keeps the full width.
 */
export const ZoneNav = () => {
	const { data } = useQuery(repoRootQueryOptions());
	const repoRoot = data?.repoRoot;

	return repoRoot === undefined ? null : (
		<aside className="flex w-full shrink-0 flex-col gap-3 border-border border-b bg-sidebar p-3 lg:w-56 lg:border-r lg:border-b-0">
			<header className="flex min-w-0 flex-col gap-1 px-1">
				<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Your repo</span>
				<MetadataTag className="min-w-0 truncate" title={repoRoot}>
					{repoRoot}
				</MetadataTag>
			</header>
			<nav aria-label="Your repo" className="flex min-w-0 gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
				<Link to="/repo" className={zoneLinkClasses} activeProps={zoneLinkActive} activeOptions={{ exact: true }}>
					<Activity aria-hidden="true" className="size-4" />
					Health
				</Link>
				<Link to="/repo/runs" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<ScrollText aria-hidden="true" className="size-4" />
					Runs
				</Link>
				<Link to="/repo/plans" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<NotebookPen aria-hidden="true" className="size-4" />
					Plans
				</Link>
				<Link to="/repo/standards" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<SquareCheckBig aria-hidden="true" className="size-4" />
					Standards
				</Link>
				<Link to="/repo/friction" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<MessageSquareWarning aria-hidden="true" className="size-4" />
					Friction
				</Link>
				<Link to="/repo/config" className={zoneLinkClasses} activeProps={zoneLinkActive}>
					<FileCog aria-hidden="true" className="size-4" />
					Config
				</Link>
			</nav>
		</aside>
	);
};

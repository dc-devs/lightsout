import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';

interface Crumb {
	label: string;
	/**
	 * Everything the router needs to reach that page, omitted on the last crumb
	 * — which is the page already open. Stated as the router's own prop type so
	 * a crumb for a path with parameters is spelled the way every other link in
	 * the app is.
	 */
	link?: LinkProps;
}

interface Props {
	crumbs: Crumb[];
}

/**
 * The trail above a page's heading — "Your repo / Runs / a3808d03".
 *
 * The last crumb is deliberately not a link: it is the page a reader is already
 * on, and `aria-current` is what says so to anything that is not looking at the
 * styling.
 */
export const ContentHeader = ({ crumbs }: Props) => (
	<nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
		{crumbs.map((crumb, index) => (
			<Fragment key={crumb.label}>
				{index === 0 ? null : <ChevronRight aria-hidden="true" className="size-3" />}
				{crumb.link === undefined ? (
					<span aria-current="page" className="text-foreground">
						{crumb.label}
					</span>
				) : (
					<Link {...crumb.link} className="transition-colors hover:text-foreground">
						{crumb.label}
					</Link>
				)}
			</Fragment>
		))}
	</nav>
);

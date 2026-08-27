import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, ThemeToggle } from '#src/appUI/index.ts';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';

const siteLinkClasses = 'text-sm text-muted-foreground-strong transition-colors hover:text-foreground';

/**
 * The site's own pages, in the order the header reads them.
 *
 * Rendered twice — once in the row a wide screen shows, once inside the menu a
 * narrow one opens — so the two can never drift into offering different pages.
 *
 * `App` is first and conditional: it is the way into this machine's own
 * repository, and a visitor with no repository below the page has nothing to
 * open, so they are offered nothing rather than a link to an empty tool.
 *
 * Docs has no index of its own, so the header points at the configuration doc —
 * the one a reader arriving from the front page wants first.
 */
const SitePages = ({ hasRepo }: { hasRepo: boolean }) => (
	<>
		{hasRepo ? (
			<Link to="/repo" className={siteLinkClasses}>
				App
			</Link>
		) : null}
		<Link to="/standards" className={siteLinkClasses}>
			Standards Packs
		</Link>
		<Link to="/commands" className={siteLinkClasses}>
			Commands
		</Link>
		<Link to="/docs/$doc" params={{ doc: 'configuration' }} className={siteLinkClasses}>
			Docs
		</Link>
	</>
);

/**
 * The header the marketing pages wear.
 *
 * It has no background and no rule under it: it sits on whatever the page
 * behind it is painting, so the landing page's hero runs up under the wordmark
 * instead of starting below a grey strip. That is the whole difference from the
 * app's bar, and it is the reason there are two of them.
 *
 * Subscribes rather than suspends — a repository lookup that fails must not
 * take the header down with it, since every page under this header is readable
 * without one.
 */
export const SiteHeader = () => {
	const { data } = useQuery(repoRootQueryOptions());
	const hasRepo = data?.repoRoot !== undefined;
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<header className="absolute inset-x-0 top-0 z-20 flex items-center gap-6 px-6 py-5 lg:px-10">
			<Link to="/" className="font-semibold text-lg">
				lightsout
			</Link>
			<nav aria-label="Site" className="hidden items-center gap-6 md:flex">
				<SitePages hasRepo={hasRepo} />
			</nav>
			<div className="ml-auto flex items-center gap-1">
				<ThemeToggle />
				<Button asChild variant="ghost" size="sm">
					<a href="https://github.com/dc-devs/lightsout" target="_blank" rel="noreferrer">
						GitHub
					</a>
				</Button>
				<Button type="button" variant="ghost" size="icon" aria-label="Open menu" className="md:hidden" onClick={() => setMenuOpen(true)}>
					<Menu className="size-4" />
				</Button>
			</div>
			<Dialog open={menuOpen} onOpenChange={setMenuOpen} title="Menu">
				<nav aria-label="Site pages" className="flex flex-col gap-3">
					<SitePages hasRepo={hasRepo} />
				</nav>
			</Dialog>
		</header>
	);
};

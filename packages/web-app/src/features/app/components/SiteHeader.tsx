import { Link } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#src/appUI/buttons/Button.tsx';
import { ThemeToggle } from '#src/appUI/buttons/ThemeToggle.tsx';
import { Dialog } from '#src/appUI/Dialog.tsx';
import { GithubMark } from '#src/appUI/icons/GithubMark.tsx';
import { Wordmark } from '#src/features/app/components/Wordmark.tsx';

const siteLinkClasses = 'font-medium text-muted-foreground-strong transition-colors hover:text-foreground';

/**
 * The site's own pages, in the order the header reads them.
 *
 * Rendered twice — once in the row a wide screen shows, once inside the menu a
 * narrow one opens — so the two can never drift into offering different pages.
 *
 * Public pages only: nothing here leads into the app, which reads a repo these
 * pages never look at.
 *
 * Docs has no index of its own, so the header points at the configuration doc —
 * the one a reader arriving from the front page wants first.
 */
const SitePages = () => (
	<>
		<Link to="/standards-packs" className={siteLinkClasses}>
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
 * It stays pinned while the page scrolls under it, so a reader deep in a long
 * page is one press from the other pages. The page shows through it, softened,
 * and a rule marks where it ends — the landing page is one long read, and the
 * header has to stay legible over every section it passes.
 */
export const SiteHeader = () => {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<header className="sticky top-0 z-30 flex items-center gap-10 border-border border-b bg-background/80 px-4 py-4 backdrop-blur-md sm:px-6 lg:px-8">
			<Wordmark />
			<nav aria-label="Site" className="hidden items-center gap-8 md:flex">
				<SitePages />
			</nav>
			<div className="ml-auto flex items-center gap-1">
				<ThemeToggle />
				<Button asChild variant="ghost" size="icon" className="text-foreground hover:text-foreground/70">
					<a href="https://github.com/lightsout-factory/lightsout" target="_blank" rel="noreferrer" aria-label="GitHub">
						<GithubMark className="size-4.5" />
					</a>
				</Button>
				<Button type="button" variant="ghost" size="icon" aria-label="Open menu" className="md:hidden" onClick={() => setMenuOpen(true)}>
					<Menu className="size-4" />
				</Button>
			</div>
			<Dialog open={menuOpen} onOpenChange={setMenuOpen} title="Menu">
				<nav aria-label="Site pages" className="flex flex-col gap-3">
					<SitePages />
				</nav>
			</Dialog>
		</header>
	);
};

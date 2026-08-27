import { Link } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, ThemeToggle } from '#src/appUI/index.ts';

/**
 * The sell-zone pages that are not routed yet.
 *
 * Named here rather than linked so the bar is honest about what exists: a
 * `Link` to a path with no route behind it navigates a reader into the
 * not-found panel, and a bar that silently omits them would read as though the
 * app had fewer pages than it will. Each leaves this list for a `Link` in the
 * phase that builds it — Standards packs already has.
 */
const upcomingPages = [
	{ label: 'Commands', note: 'The commands page arrives with the command catalog.' },
	{ label: 'Docs', note: 'The docs pages arrive with the command catalog.' },
];

const UpcomingPage = ({ label, note }: { label: string; note: string }) => (
	<span aria-disabled="true" title={note} className="cursor-default text-muted-foreground text-sm">
		{label}
	</span>
);

/**
 * The sell zone's pages, in the order the bar reads them.
 *
 * Rendered twice — once in the row a wide screen shows, once inside the menu a
 * narrow one opens — so the two can never drift into offering different pages.
 * The `nav` around it differs by label and layout; what it holds does not.
 */
const SitePages = () => (
	<>
		<Link to="/standards" className="text-sm">
			Standards packs
		</Link>
		{upcomingPages.map((page) => (
			<UpcomingPage key={page.label} label={page.label} note={page.note} />
		))}
	</>
);

/**
 * The bar across the top of every page: which product this is, where else it
 * goes, and the two controls that belong to the reader rather than to a page.
 *
 * Below `md` the pages collapse behind a menu button, so a phone gets the
 * wordmark and the theme control at full size instead of a squeezed row.
 */
export const TopNav = () => {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<header className="flex shrink-0 items-center gap-4 border-border border-b bg-background px-4 py-3">
			<Link to="/" className="font-semibold text-base">
				lightsout
			</Link>
			<nav aria-label="Site" className="hidden items-center gap-4 md:flex">
				<SitePages />
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
					<SitePages />
				</nav>
			</Dialog>
		</header>
	);
};

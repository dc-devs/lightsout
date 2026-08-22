import { Link } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, ThemeToggle } from '#src/appUI/index.ts';

/**
 * The sell zone's own pages, none of which is routed yet.
 *
 * Named here rather than linked so the bar is honest about what exists: a
 * `Link` to a path with no route behind it navigates a reader into the
 * not-found panel, and a bar that silently omits them would read as though the
 * app had three pages. Each becomes a `Link` in the phase that builds it.
 */
const upcomingPages = [
	{ label: 'Standards packs', note: 'The standards packs page arrives with the pack pages.' },
	{ label: 'Commands', note: 'The commands page arrives with the command catalog.' },
	{ label: 'Docs', note: 'The docs pages arrive with the command catalog.' },
];

const UpcomingPage = ({ label, note }: { label: string; note: string }) => (
	<span aria-disabled="true" title={note} className="cursor-default text-muted-foreground text-sm">
		{label}
	</span>
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
				{upcomingPages.map((page) => (
					<UpcomingPage key={page.label} label={page.label} note={page.note} />
				))}
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
					{upcomingPages.map((page) => (
						<UpcomingPage key={page.label} label={page.label} note={page.note} />
					))}
				</nav>
			</Dialog>
		</header>
	);
};

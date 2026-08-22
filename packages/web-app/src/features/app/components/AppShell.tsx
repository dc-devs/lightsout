import { Outlet } from '@tanstack/react-router';
import { TopNav } from '#src/features/app/components/TopNav.tsx';
import { ZoneNav } from '#src/features/app/components/ZoneNav.tsx';

/**
 * The frame both zones share: the site bar across the top, the local zone's own
 * navigation beside the page when a repo was found, and whatever route is open
 * scrolling in the rest.
 *
 * The main column is a scroll container of its own rather than the document, so
 * a wide table or a run timeline scrolls inside the page instead of pushing the
 * whole layout sideways on a narrow screen.
 */
export const AppShell = () => (
	<div className="flex h-screen min-h-0 w-full flex-col">
		<TopNav />
		<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
			<ZoneNav />
			<main className="min-w-0 flex-1 overflow-y-auto">
				<Outlet />
			</main>
		</div>
	</div>
);

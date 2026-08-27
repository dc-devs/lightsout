import { Outlet } from '@tanstack/react-router';
import { SiteHeader } from '#src/features/app/components/SiteHeader.tsx';

/**
 * The frame the public pages wear: a header that floats over the page, and the
 * page itself scrolling with the document.
 *
 * Nothing here reads this machine's repository. These pages are the same for a
 * reader who has never installed lightsout and for the author running it
 * locally, which is what makes the page the author is looking at the page a
 * visitor will get.
 *
 * The document scrolls rather than an inner column, because a landing page is
 * read top to bottom — the app's frame does the opposite, and that is the other
 * reason these are two shells and not one with a flag.
 */
export const SiteShell = () => (
	<div className="relative min-h-screen w-full">
		<SiteHeader />
		<main className="pt-20">
			<Outlet />
		</main>
	</div>
);

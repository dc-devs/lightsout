import { Outlet } from '@tanstack/react-router';
import { AppSidebar } from '#src/features/app/components/AppSidebar.tsx';

/** The two-pane frame: the runs sidebar on the left, whatever route is open scrolling on the right. */
export const AppShell = () => (
	<div className="flex h-screen min-h-0 w-full">
		<AppSidebar />
		<main className="min-w-0 flex-1 overflow-y-auto">
			<Outlet />
		</main>
	</div>
);

import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '#src/features/app/components/AppShell.tsx';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';

/**
 * Everything that reads this machine's repository, under one frame: the app's
 * bar, the "Your repo" column, and the page scrolling in the rest.
 *
 * The site's pages do not pass through here, which is why the landing page is
 * not wearing a sidebar — and why the one question every app page shares,
 * whether a repo was found at all, is asked here rather than at the root: the
 * public pages never ask it.
 */
export const Route = createFileRoute('/app')({
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(repoRootQueryOptions());
	},
	component: AppShell,
});

import { createFileRoute, notFound } from '@tanstack/react-router';
import { isPublicDeployment } from '#src/common/utils/isPublicDeployment.ts';
import { AppShell } from '#src/features/app/components/AppShell.tsx';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';

/**
 * Everything that reads this machine's repository, under one frame: the app's
 * bar, the "Your repo" column, and the page scrolling in the rest.
 *
 * On the public site none of it exists. The check sits in `beforeLoad`, which
 * runs before any page under `/app` loads, so every page here — and every page
 * added later — answers not-found without a line of its own. The server
 * functions behind these pages refuse on their own as well, so the check here
 * is what the reader sees, not what keeps the disk private.
 *
 * Locally, the repo root is fetched here too rather than in a loader: loaders
 * under one match run side by side, and a server started outside any repo
 * should show the one message naming the fix rather than a failure per page.
 * The site's pages never pass through here, which is why the landing page is
 * not wearing a sidebar.
 */
export const Route = createFileRoute('/app')({
	beforeLoad: async ({ context }) => {
		if (isPublicDeployment()) {
			throw notFound();
		}

		await context.queryClient.ensureQueryData(repoRootQueryOptions());
	},
	component: AppShell,
});

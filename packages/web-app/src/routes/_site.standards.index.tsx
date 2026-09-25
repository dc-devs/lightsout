import { createFileRoute } from '@tanstack/react-router';
import { packsQueryOptions } from '#src/features/packs/queries/packsQueryOptions.ts';
import { PacksPage } from '#src/features/packs/screens/PacksPage/PacksPage.tsx';

export const Route = createFileRoute('/_site/standards/')({
	// Warmed before the first render, so the list is server-rendered with its
	// packs rather than arriving as a shell the client has to fill. A build with
	// no repo under it still resolves — the list comes back empty and the page
	// says so.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(packsQueryOptions());
	},
	component: PacksPage,
});

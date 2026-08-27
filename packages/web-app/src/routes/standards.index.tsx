import { createFileRoute } from '@tanstack/react-router';
import { PacksPage, packsQueryOptions } from '#src/features/packs/index.ts';

export const Route = createFileRoute('/standards/')({
	// Warmed before the first render, so the list is server-rendered with its
	// packs rather than arriving as a shell the client has to fill. A build with
	// no repo under it still resolves — the list comes back empty and the page
	// says so.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(packsQueryOptions());
	},
	component: PacksPage,
});

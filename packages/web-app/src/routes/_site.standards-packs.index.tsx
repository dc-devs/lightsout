import { createFileRoute } from '@tanstack/react-router';
import { defaultPackQueryOptions, PacksPage } from '#src/features/packs/index.ts';

export const Route = createFileRoute('/_site/standards-packs/')({
	// Warmed before the first render, so the page is server-rendered with its
	// cards rather than arriving as a shell the client has to fill.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(defaultPackQueryOptions());
	},
	component: PacksPage,
});

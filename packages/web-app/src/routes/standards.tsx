import { createFileRoute } from '@tanstack/react-router';
import { StandardsPage, standardsQueryOptions } from '#src/features/standards/index.ts';

export const Route = createFileRoute('/standards')({
	// Warmed before the first render, so the tab is server-rendered with its
	// findings rather than arriving as a shell the client has to fill.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(standardsQueryOptions());
	},
	component: StandardsPage,
});

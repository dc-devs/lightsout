import { createFileRoute } from '@tanstack/react-router';
import { RunsPage, runsQueryOptions } from '#src/features/runs/index.ts';

export const Route = createFileRoute('/repo/runs')({
	// Warmed before the first render, so the list is server-rendered with its
	// runs rather than arriving as a shell the client has to fill.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(runsQueryOptions());
	},
	component: RunsPage,
});

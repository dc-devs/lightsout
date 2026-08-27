import { createFileRoute } from '@tanstack/react-router';
import { CommandsPage, commandsQueryOptions } from '#src/features/commands/index.ts';

export const Route = createFileRoute('/commands/')({
	// Warmed before the first render, so the grid is server-rendered with its
	// cards. The catalog is engine source rather than repo state, so this
	// resolves on a build with no repo under it exactly as it does locally.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(commandsQueryOptions());
	},
	head: () => ({ meta: [{ title: 'Commands' }] }),
	component: CommandsPage,
});

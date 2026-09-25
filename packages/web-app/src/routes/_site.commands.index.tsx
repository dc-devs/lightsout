import { createFileRoute } from '@tanstack/react-router';
import { commandsQueryOptions } from '#src/features/commands/queries/commandsQueryOptions.ts';
import { CommandsPage } from '#src/features/commands/screens/CommandsPage/CommandsPage.tsx';

export const Route = createFileRoute('/_site/commands/')({
	// Warmed before the first render, so the grid is server-rendered with its
	// cards. The catalog is engine source rather than repo state, so this
	// resolves on a build with no repo under it exactly as it does locally.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(commandsQueryOptions());
	},
	head: () => ({ meta: [{ title: 'Commands' }] }),
	component: CommandsPage,
});

import { createFileRoute } from '@tanstack/react-router';
import { configQueryOptions } from '#src/features/config/queries/configQueryOptions.ts';
import { ConfigPage } from '#src/features/config/screens/ConfigPage/ConfigPage.tsx';

export const Route = createFileRoute('/repo/config')({
	// A repo with no config answers this with the router's own not-found; a repo
	// whose config will not parse throws here, and the message that says which key
	// is wrong reaches the error boundary intact.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(configQueryOptions());
	},
	head: () => ({ meta: [{ title: 'Config' }] }),
	component: ConfigPage,
});

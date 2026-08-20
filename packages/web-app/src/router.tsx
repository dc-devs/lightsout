import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routerWithQueryClient } from '@tanstack/react-router-with-query';
import { DefaultCatchBoundary } from '#src/common/components/boundaries/DefaultCatchBoundary.tsx';
import { NotFound } from '#src/common/components/boundaries/NotFound.tsx';
import { routeTree } from '#src/routeTree.gen.ts';

export const getRouter = () => {
	const queryClient = new QueryClient();

	return routerWithQueryClient(
		createTanStackRouter({
			routeTree,
			context: { queryClient },
			defaultPreload: false,
			defaultErrorComponent: DefaultCatchBoundary,
			defaultNotFoundComponent: () => <NotFound />,
			scrollRestoration: true,
		}),
		queryClient,
	);
};

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

interface SeededQuery {
	queryKey: readonly unknown[];
	data: unknown;
}

interface Params {
	ui: ReactNode;
	/** One entry per query key the tree under test reads, so no `queryFn` ever runs. */
	seed?: SeededQuery[];
}

/**
 * Render a tree that reads TanStack Query, with its cache filled in advance.
 *
 * The seam a component test needs is React Query's own cache, not a mocked
 * framework: seeding every key the tree reads means `useSuspenseQuery` resolves
 * synchronously, no server function is ever called, and nothing about the
 * framework has to be faked. A key left unseeded is how a test exercises the
 * loading state instead.
 */
export const renderWithQueryClient = ({ ui, seed = [] }: Params): { queryClient: QueryClient } => {
	// Never stale and never refetched on mount: seeded data has to be the whole
	// answer, or a background refetch would reach for the real server function
	// the seeding exists to avoid.
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, refetchOnMount: false } },
	});

	for (const { queryKey, data } of seed) {
		queryClient.setQueryData(queryKey, data);
	}

	render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);

	return { queryClient };
};

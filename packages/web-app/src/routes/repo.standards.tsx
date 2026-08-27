import { createFileRoute } from '@tanstack/react-router';
import { StandardsPage, standardsQueryOptions } from '#src/features/standards/index.ts';

/**
 * What the query string may say.
 *
 * One optional key: the rule the findings table is narrowed to. Anything else a
 * URL carries drops to `undefined`, which is the page's own "all rules" — a
 * cleared filter leaves no key behind, and a link written by hand cannot put the
 * page into a state it has no way out of.
 */
interface StandardsSearch {
	rule?: string;
}

const validateSearch = (search: Record<string, unknown>): StandardsSearch => ({
	rule: typeof search.rule === 'string' && search.rule !== '' ? search.rule : undefined,
});

export const Route = createFileRoute('/repo/standards')({
	validateSearch,
	// Warmed before the first render, so the page is server-rendered with its
	// findings rather than arriving as a shell the client has to fill.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(standardsQueryOptions());
	},
	head: () => ({ meta: [{ title: 'Standards' }] }),
	component: StandardsPage,
});

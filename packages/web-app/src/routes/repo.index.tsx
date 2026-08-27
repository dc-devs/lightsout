import { createFileRoute } from '@tanstack/react-router';
import { RunsIndex } from '#src/features/app/index.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';

export const Route = createFileRoute('/repo/')({
	head: () => ({ meta: [{ title: 'Your repo' }] }),
	// Warmed here rather than by the root, which no longer lists runs: the page
	// suspends on them, and a repo with no run state answers with an empty list
	// rather than failing.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(runsQueryOptions());
	},
	component: RunsIndex,
});

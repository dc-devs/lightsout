import { createFileRoute } from '@tanstack/react-router';
import { RepoHealth } from '#src/features/repo/index.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';

export const Route = createFileRoute('/repo/')({
	head: () => ({ meta: [{ title: 'Health' }] }),
	// Only the runs. The standards check and the friction log are things a repo
	// may never have produced, so the page subscribes to those rather than
	// suspending on them and a repo with neither still renders.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(runsQueryOptions());
	},
	component: RepoHealth,
});

import { createFileRoute } from '@tanstack/react-router';
import { FrictionPage, frictionQueryOptions } from '#src/features/friction/index.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';

export const Route = createFileRoute('/repo/friction')({
	// Both warmed here: the page suspends on the log, and the runs are what put a
	// title beside a run id rather than a bare short id.
	loader: async ({ context }) => {
		await Promise.all([context.queryClient.ensureQueryData(frictionQueryOptions()), context.queryClient.ensureQueryData(runsQueryOptions())]);
	},
	head: () => ({ meta: [{ title: 'Friction' }] }),
	component: FrictionPage,
});

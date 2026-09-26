import { createFileRoute } from '@tanstack/react-router';
import { frictionQueryOptions } from '#src/features/friction/queries/frictionQueryOptions.ts';
import { FrictionPage } from '#src/features/friction/screens/FrictionPage.tsx';
import { runsQueryOptions } from '#src/features/runs/queries/runsQueryOptions.ts';

export const Route = createFileRoute('/app/friction')({
	// Both warmed here: the page suspends on the log, and the runs are what put a
	// title beside a run id rather than a bare short id.
	loader: async ({ context }) => {
		await Promise.all([context.queryClient.ensureQueryData(frictionQueryOptions()), context.queryClient.ensureQueryData(runsQueryOptions())]);
	},
	head: () => ({ meta: [{ title: 'Friction' }] }),
	component: FrictionPage,
});

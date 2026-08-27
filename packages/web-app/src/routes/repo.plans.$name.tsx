import { createFileRoute } from '@tanstack/react-router';
import { AddressNotFound } from '#src/common/components/boundaries/AddressNotFound.tsx';
import { PlanDetail, planWorkspaceQueryOptions } from '#src/features/plans/index.ts';

/**
 * No folder under `.lightsout/plans/` answers to the name in the path.
 *
 * Reached because `getPlanWorkspaceServerFn` turns the engine's
 * `PlanWorkspaceNotFoundError` into the router's own not-found signal on the
 * server — an error class cannot survive the trip across the wire, so nothing
 * here matches one.
 */
const PlanNotFound = () => {
	const { name } = Route.useParams();

	return (
		<AddressNotFound title="No plan by that name.">
			Nothing under <span className="font-mono">.lightsout/plans/</span> is named <span className="font-mono">{name}</span>. Pick one from the plans list.
		</AddressNotFound>
	);
};

const PlanDetailPage = () => {
	const { name } = Route.useParams();

	return <PlanDetail name={name} />;
};

export const Route = createFileRoute('/repo/plans/$name')({
	// Warmed before the first render, so the page is server-rendered with its
	// records rather than arriving as a shell the client has to fill.
	loader: async ({ context, params }) => {
		await context.queryClient.ensureQueryData(planWorkspaceQueryOptions({ name: params.name }));
	},
	// From the path alone, so the tab is named before the query resolves.
	head: ({ params }) => ({ meta: [{ title: `${params.name} — plan` }] }),
	component: PlanDetailPage,
	notFoundComponent: PlanNotFound,
});

import { PlanStage } from '@lightsout/engine/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { PlansPage, planWorkspacesQueryOptions } from '#src/features/plans/index.ts';

/**
 * What the query string may say.
 *
 * One optional key, and an absent key means "do not narrow on this" — a cleared
 * filter drops out of the URL entirely, exactly as the runs table's do.
 */
interface PlansSearch {
	stage?: PlanStage;
}

/** A URL value from the closed set of stages, or nothing — a key naming anything else narrows nothing rather than emptying the table. */
const validateSearch = (search: Record<string, unknown>): PlansSearch => ({
	stage: Object.values(PlanStage).find((stage) => stage === search.stage),
});

export const Route = createFileRoute('/repo/plans/')({
	validateSearch,
	// Warmed before the first render, so the table is server-rendered with its
	// plans rather than arriving as a shell the client has to fill.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(planWorkspacesQueryOptions());
	},
	head: () => ({ meta: [{ title: 'Plans' }] }),
	component: PlansPage,
});

import { createFileRoute } from '@tanstack/react-router';
import { RunDetail, runQueryOptions } from '#src/features/runDetail/index.ts';

// The trailing underscore on `runs_` is the router's own spelling for "this
// path segment is not a layout": without it the file router would nest the
// detail page inside the runs list and render both at once. The path a reader
// and every `Link` sees is still /repo/runs/$runId.

/**
 * No run on disk answers to the id in the path.
 *
 * Reached because `getRunServerFn` turns the engine's `RunNotFoundError` into
 * the router's own not-found signal on the server — an error class cannot
 * survive the trip across the wire, so nothing here matches one. Anything
 * genuinely unexpected falls through to the root's catch boundary instead.
 */
const RunNotFound = () => {
	const { runId } = Route.useParams();

	return (
		<div className="flex h-full flex-col items-start justify-center gap-2 p-10">
			<h1 className="font-semibold text-lg">No run matching that id.</h1>
			<p className="text-muted-foreground text-sm">
				Nothing on disk answers to <span className="font-mono">{runId}</span>. Pick one from the runs list.
			</p>
		</div>
	);
};

const RunDetailPage = () => {
	const { runId } = Route.useParams();

	return <RunDetail runId={runId} />;
};

export const Route = createFileRoute('/repo/runs_/$runId')({
	// Warmed before the first render, so the page is server-rendered with its
	// evidence rather than arriving as a shell the client has to fill.
	loader: async ({ context, params }) => {
		await context.queryClient.ensureQueryData(runQueryOptions({ runId: params.runId }));
	},
	component: RunDetailPage,
	notFoundComponent: RunNotFound,
});

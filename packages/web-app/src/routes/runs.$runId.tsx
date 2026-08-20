import { createFileRoute } from '@tanstack/react-router';

const RunDetailPlaceholder = () => {
	const { runId } = Route.useParams();

	return <p className="p-10 text-muted-foreground text-sm">Run {runId} — detail arrives in the next phase.</p>;
};

export const Route = createFileRoute('/runs/$runId')({ component: RunDetailPlaceholder });

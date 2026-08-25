import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/runs/$runId')({
	component: () => <section>run detail</section>,
});

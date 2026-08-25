import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/runs/$runId')({ component: () => <h1>Run</h1> });

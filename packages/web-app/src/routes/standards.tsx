import { createFileRoute } from '@tanstack/react-router';

const StandardsPlaceholder = () => <p className="p-10 text-muted-foreground text-sm">The standards tab arrives in a later phase.</p>;

export const Route = createFileRoute('/standards')({ component: StandardsPlaceholder });

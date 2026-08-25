import { createFileRoute } from '@tanstack/react-router';

const RunsIndex = () => <section>runs</section>;

export const Route = createFileRoute('/')({ component: RunsIndex });

import { createFileRoute } from '@tanstack/react-router';
import { RunsIndex } from '#src/features/app/index.ts';

export const Route = createFileRoute('/')({ component: RunsIndex });

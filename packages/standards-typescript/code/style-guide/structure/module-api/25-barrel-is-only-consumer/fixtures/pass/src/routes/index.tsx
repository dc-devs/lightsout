import { createFileRoute } from '@tanstack/react-router';
import { RunsIndex } from '../features/app/screens/RunsIndex/RunsIndex';

export const Route = createFileRoute('/')({ component: RunsIndex });

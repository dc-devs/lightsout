import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '#src/features/app/index.ts';

/**
 * Everything that reads this machine's repository, under one frame: the app's
 * bar, the "Your repo" column, and the page scrolling in the rest.
 *
 * The site's pages do not pass through here, which is why the landing page is
 * not wearing a sidebar.
 */
export const Route = createFileRoute('/repo')({ component: AppShell });

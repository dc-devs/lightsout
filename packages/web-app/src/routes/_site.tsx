import { createFileRoute } from '@tanstack/react-router';
import { SiteShell } from '#src/features/app/index.ts';

/**
 * The public site: the landing page, the standards packs, the commands and the
 * docs.
 *
 * Pathless, so every page under it keeps the URL it had — `/standards` is still
 * `/standards`. What the file buys is that a page belongs to the site by where
 * it sits rather than by a list somebody has to remember to update.
 */
export const Route = createFileRoute('/_site')({ component: SiteShell });

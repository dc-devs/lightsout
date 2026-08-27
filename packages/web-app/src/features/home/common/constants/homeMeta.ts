import sprawlGif from '#assets/sprawl.gif?url';
import { heroDescription } from '#src/features/home/common/constants/heroDescription.ts';

/**
 * Where this build is served from, when the deploy said.
 *
 * Read from `process.env` rather than `import.meta.env`, which the app's own
 * suite cannot parse: Jest compiles this file to CommonJS, where `import.meta`
 * is a syntax error. `vite.config.ts` substitutes the value at build time, so
 * the browser gets the same answer this file would have read either way.
 *
 * Unset — local dev, a preview with no known origin — is a normal state: the
 * two tags that need an absolute URL are then left out rather than emitted with
 * a relative path a scraper ignores.
 */
const siteOrigin = process.env.VITE_SITE_ORIGIN;

const homeTitle = 'lightsout — Stop the slop.';

const origin = siteOrigin === undefined || siteOrigin === '' ? undefined : siteOrigin.replace(/\/$/, '');

/**
 * What Home tells a browser, a search engine and whatever a link to it was
 * pasted into.
 *
 * A page opened from a post on a phone needs a title and an image of its own;
 * the root's "lightsout" is the fallback for routes that say nothing, not this
 * page's name.
 */
export const homeMeta = [
	{ title: homeTitle },
	{ name: 'description', content: heroDescription },
	{ property: 'og:title', content: homeTitle },
	{ property: 'og:description', content: heroDescription },
	...(origin === undefined
		? []
		: [
				{ property: 'og:image', content: `${origin}${sprawlGif}` },
				{ property: 'og:url', content: `${origin}/` },
			]),
];

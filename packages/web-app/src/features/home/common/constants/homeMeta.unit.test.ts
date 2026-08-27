import { describe, expect, jest, test } from '@jest/globals';
import { homeMeta } from '#src/features/home/common/constants/homeMeta.ts';

type MetaTags = typeof homeMeta;

/** One tag's content, by whichever attribute names it — `name` for the standard tags, `property` for the Open Graph ones. */
const contentOf = ({ key, meta = homeMeta }: { key: string; meta?: MetaTags }) => {
	const tag = meta.find((entry) => ('name' in entry && entry.name === key) || ('property' in entry && entry.property === key));

	return tag !== undefined && 'content' in tag ? tag.content : undefined;
};

/** The one tag that carries a title rather than content. */
const readTitle = () => {
	const tag = homeMeta.find((entry) => 'title' in entry);

	return tag !== undefined && 'title' in tag ? tag.title : undefined;
};

/**
 * The tags a build with the given deploy origin produces.
 *
 * The origin is read once, the moment the module is first required, so requiring
 * it is the act — hence `isolateModules`, which gives each test a module registry
 * of its own and so a genuine re-read of that line. The whole `process.env`
 * object is replaced rather than the one key, because assigning `undefined` to a
 * key of `process.env` stores the string "undefined" — and `restoreMocks` puts
 * the real object back before the next test.
 */
const setupHomeMeta = ({ siteOrigin }: { siteOrigin?: string }) => {
	const environment = { ...process.env };

	if (siteOrigin === undefined) {
		delete environment.VITE_SITE_ORIGIN;
	} else {
		environment.VITE_SITE_ORIGIN = siteOrigin;
	}

	jest.replaceProperty(process, 'env', environment);

	let meta: MetaTags = [];

	jest.isolateModules(() => {
		meta = (require('#src/features/home/common/constants/homeMeta.ts') as { homeMeta: MetaTags }).homeMeta;
	});

	return { meta };
};

describe('homeMeta', () => {
	test('names the page rather than leaving it on the root’s fallback', () => {
		expect(readTitle()).toBe('lightsout — Stop the slop.');
	});

	test('describes it in the hero’s own words, so a search result and the page agree', () => {
		expect(contentOf({ key: 'description' })).toContain('Your coding agent solves the task in front of it and moves on.');
	});

	test('carries the two social tags that need no absolute URL, so a shared link always has a title', () => {
		expect({ title: contentOf({ key: 'og:title' }), description: contentOf({ key: 'og:description' }) }).toStrictEqual({
			title: 'lightsout — Stop the slop.',
			description: contentOf({ key: 'description' }),
		});
	});

	test('leaves out the two that need one when no deploy origin was stated, rather than emitting a path a scraper ignores', () => {
		// The suite runs with VITE_SITE_ORIGIN unset, which is also local dev and
		// any preview with no settled origin.
		expect({ image: contentOf({ key: 'og:image' }), url: contentOf({ key: 'og:url' }) }).toStrictEqual({ image: undefined, url: undefined });
	});

	test('leaves them out for a build that declared the origin but left it blank, which states no origin either', () => {
		const { meta } = setupHomeMeta({ siteOrigin: '' });

		expect({ image: contentOf({ key: 'og:image', meta }), url: contentOf({ key: 'og:url', meta }) }).toStrictEqual({ image: undefined, url: undefined });
	});

	test('points the preview image at the deploy’s own origin, absolute, as a scraper requires', () => {
		const { meta } = setupHomeMeta({ siteOrigin: 'https://lightsout.dev' });

		expect(contentOf({ key: 'og:image', meta })).toMatch(/^https:\/\/lightsout\.dev\/.+/);
	});

	test('keeps the four tags that need no origin when one is stated, so nothing is traded for the image', () => {
		const { meta } = setupHomeMeta({ siteOrigin: 'https://lightsout.dev' });

		expect({ title: contentOf({ key: 'og:title', meta }), description: contentOf({ key: 'og:description', meta }) }).toStrictEqual({
			title: 'lightsout — Stop the slop.',
			description: contentOf({ key: 'description', meta }),
		});
	});

	test.each([
		{ siteOrigin: 'https://lightsout.dev', expected: 'https://lightsout.dev/' },
		{ siteOrigin: 'https://lightsout.dev/', expected: 'https://lightsout.dev/' },
	])('reads $siteOrigin as the page URL $expected, so a trailing slash in the deploy variable is not doubled', ({ siteOrigin, expected }) => {
		const { meta } = setupHomeMeta({ siteOrigin });

		expect(contentOf({ key: 'og:url', meta })).toBe(expected);
	});
});

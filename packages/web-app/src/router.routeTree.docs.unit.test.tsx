import { describe, expect, jest, test } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { createRouter, isNotFound } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { routeTree } from '#src/routeTree.gen.ts';

// Mocked Imports
// -------------------------
// Only the piece that needs a live router around it is stood in for, so this one
// route's component can be rendered on its own. Everything else — above all
// `createRouter`, `notFound` and the `createFileRoute` calls the tree is
// assembled from — stays real, since the tree is what is under test here.
jest.mock('@tanstack/react-router', () => {
	const actual = jest.requireActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');

	return {
		...actual,
		Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
			<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
				{children}
			</a>
		),
	};
});
// -------------------------

/** The one path parameter this route carries — the document's own name. */
interface PageParams {
	doc: string;
}

/**
 * The docs file route, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back. The loader
 * is stated as returning nothing because there is nothing to fetch: the
 * markdown is bundled, so all it does is decide whether the path names a
 * document at all.
 */
interface FilePage {
	options: {
		component: ComponentType;
		notFoundComponent: ComponentType;
		loader: (input: { params: PageParams }) => void;
		head: (input: { params: PageParams }) => { meta: { title: string }[] };
	};
	useParams: () => PageParams;
}

const setupDocsRoute = () => {
	// The tree's root declares a query client in its context, so one has to exist
	// for the router to be built at all. Nothing on this route ever reads it: the
	// markdown is bundled with the app, which is most of what these pages are for.
	const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
	const route = (router as unknown as { routesById: Record<string, FilePage> }).routesById['/docs/$doc'];

	return { head: route.options.head, loader: route.options.loader, route };
};

/**
 * The route's page, rendered for one document name.
 *
 * `Route.useParams()` reads the match a live router is showing, so the name
 * comes from a spy rather than from a router driven to the path — which is the
 * routing library's behaviour, not this route's.
 */
const setupDocPage = ({ doc = 'configuration' }: { doc?: string } = {}) => {
	const { route } = setupDocsRoute();
	jest.spyOn(route, 'useParams').mockReturnValue({ doc });
	const Page = route.options.component;

	render(<Page />);
};

/** The same route's answer for a name no document this build carries. */
const setupMissingDocPage = () => {
	const { route } = setupDocsRoute();
	const Page = route.options.notFoundComponent;

	render(<Page />);
};

/** Whatever the loader threw for one path, or `undefined` when it let that path through. */
const catchThrown = ({ run }: { run: () => void }): unknown => {
	try {
		run();

		return undefined;
	} catch (thrown) {
		return thrown;
	}
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router, split from the tree's own by concern: what
// `/docs/$doc` serves, and what it says for a name it cannot serve.
describe('routeTree docs route', () => {
	test.each([
		{ doc: 'configuration', expected: 'Configuration' },
		{ doc: 'monorepos', expected: 'Monorepos' },
	])('the docs route renders $doc, the document the path names', ({ doc, expected }) => {
		setupDocPage({ doc });

		const heading = screen.getByRole('heading', { level: 1, name: expected });

		expect(heading).toBeInTheDocument();
	});

	test('the docs route puts that document’s own headings above it, so a reader can jump into it', () => {
		setupDocPage({ doc: 'configuration' });

		const contents = screen.getByRole('navigation', { name: 'On this page' });

		expect(contents).toBeInTheDocument();
	});

	test('the docs route lets through a name this build carries, since the markdown is already in hand', () => {
		const { loader } = setupDocsRoute();

		const thrown = catchThrown({ run: () => loader({ params: { doc: 'monorepos' } }) });

		expect(thrown).toBeUndefined();
	});

	test('the docs route turns a name it carries no document for into a not-found, rather than an empty page', () => {
		const { loader } = setupDocsRoute();

		const thrown = catchThrown({ run: () => loader({ params: { doc: 'no-such-doc' } }) });

		expect(isNotFound(thrown)).toBe(true);
	});

	test('the docs route names the tab after the document, from the path alone', () => {
		const { head } = setupDocsRoute();

		const documentHead = head({ params: { doc: 'monorepos' } });

		expect(documentHead.meta).toStrictEqual([{ title: 'Monorepos — lightsout' }]);
	});

	test('the docs route still names the tab something for a path it will answer not-found for', () => {
		const { head } = setupDocsRoute();

		const documentHead = head({ params: { doc: 'no-such-doc' } });

		expect(documentHead.meta).toStrictEqual([{ title: 'Docs — lightsout' }]);
	});

	test('the docs route says plainly that nothing answers to that name', () => {
		setupMissingDocPage();

		const notice = screen.getByRole('heading', { level: 1, name: /No doc at that address/ });

		expect(notice).toBeInTheDocument();
	});

	// There is no docs index to send a reader back to, so the way out is the one
	// document the site bar itself points at — and that it points there is the
	// part a wrong link would break silently.
	test('the docs route offers the configuration doc as the way out, having no list page to return to', () => {
		setupMissingDocPage();

		const back = screen.getByRole('link', { name: /configuration doc/ });

		expect(back).toHaveAttribute('href', '/docs/configuration');
	});
});

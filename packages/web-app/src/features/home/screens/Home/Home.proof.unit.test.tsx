import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { Home } from '#src/features/home/index.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The reader behind the standards cards only, stubbed with a promise that never
// settles so nothing walks the real filesystem. Every other export is the real
// thing — the frozen runs above all, which are committed JSON rather than disk a
// test has to fake, and are the whole subject of this file.
jest.mock('#src/lightsout/index.ts', () => ({
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({ listPacks: () => new Promise(() => {}), getPackRule: () => new Promise(() => {}) }),
}));
// -------------------------
jest.mock('#src/features/app/serverFns/index.ts', () => ({ getRepoRootServerFn: () => new Promise(() => {}) }));
// -------------------------
// The links, which need a live router around them to resolve a path, and the
// not-found signal the pack server function raises — with no router mounted,
// what matters is only that each one is callable.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
	notFound: () => new Error('not found'),
}));
// -------------------------

const realRequest = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

/**
 * Long enough to cover the first request for the proof frame's own chunk.
 *
 * The frame is loaded on demand, so the first render asks for a module this
 * process has not compiled yet — and that compile blocks the very clock a
 * one-second default wait is measured against.
 */
const chunkTimeoutMs = 20_000;

/** The frozen run behind the panel the section opens on, by the title its own manifest carries. */
const cleanRunTitle = 'framework-carve-out-plumbing · phase2-import-graph-dependencies';

/**
 * The whole page with the proof section left standing.
 *
 * The page's own suite replaces the framed run with nothing, so its headings are
 * the only ones on the page; this file is the opposite arrangement — the frame
 * renders for real, which is the only way to prove the marketing page cannot
 * drift from the product it is claiming to show.
 *
 * The animation loops are driven by hand for the reason the sprawl suites give:
 * jsdom's own frames land outside React's act boundary.
 */
const setupProof = () => {
	Object.assign(globalThis, { requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined });

	renderWithQueryClient({ ui: <Home />, seed: [{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: undefined } }] });
};

/** Radix selects a tab on the press rather than on the release, so a bare click would leave the strip where it was. */
const choosePanel = ({ name }: { name: string }) => {
	fireEvent.mouseDown(screen.getByRole('tab', { name }));
};

afterEach(() => {
	Object.assign(globalThis, { requestAnimationFrame: realRequest, cancelAnimationFrame: realCancel });
});

describe('Home proof section', () => {
	test('frames a run that actually happened, drawn by the components the run page itself uses', async () => {
		setupProof();

		const title = await screen.findByRole('heading', { level: 1, name: cleanRunTitle }, { timeout: chunkTimeoutMs });

		expect(title).toBeInTheDocument();
	});

	test('shows the burn-down the engine computed, rather than numbers the page worked out for itself', async () => {
		setupProof();

		choosePanel({ name: 'A refactor burn-down' });
		const sites = await screen.findByText('11 → 0 sites · 3 resolved · 0 declined', {}, { timeout: chunkTimeoutMs });

		expect(sites).toBeInTheDocument();
		expect(screen.getByText('files over cap: 7 → 0')).toBeInTheDocument();
	});

	test('says why the run that stopped stopped, and offers no command a reader with no repo of their own could run', async () => {
		setupProof();

		choosePanel({ name: 'A run that stopped' });
		const title = await screen.findByRole('heading', { level: 1, name: 'web-app-design · phase4-home' }, { timeout: chunkTimeoutMs });

		expect(title).toBeInTheDocument();
		expect(screen.getByText(/the supervisor asked for a human decision/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Copy resume command' })).not.toBeInTheDocument();
	});
});

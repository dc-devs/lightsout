import { describe, expect, jest, test } from '@jest/globals';
import type { ReactElement } from 'react';

// Mocked Imports
// -------------------------
const mockHydrateRoot = jest.fn<(container: Document | Element, element: ReactElement) => unknown>();

jest.mock('react-dom/client', () => ({
	hydrateRoot: (container: Document | Element, element: ReactElement) => mockHydrateRoot(container, element),
}));
// -------------------------
const mockStartTransition = jest.fn<(scope: () => void) => void>();

// Partial: React still exports everything it always did, and only
// startTransition is observable. That is what lets a test prove hydration is
// scheduled *inside* the transition rather than merely beside a call to one.
jest.mock('react', () => ({
	...jest.requireActual<typeof import('react')>('react'),
	startTransition: (scope: () => void) => mockStartTransition(scope),
}));
// -------------------------

/**
 * Load the browser entry and report what it handed to `hydrateRoot`.
 *
 * The entry acts the moment it is imported, so importing it is the act — hence
 * `isolateModules`, which gives every test a module registry of its own and so a
 * genuinely fresh run of those three lines. The two component identities are
 * read back from inside that same registry, because a fresh registry re-runs the
 * modules it loads and the copies this file imported would be a different pair.
 * With `transitionRuns: false` the transition's callback is captured and never
 * invoked, which is how a test sees whether hydration really lives inside it.
 */
const setupClientEntry = ({ transitionRuns = true }: { transitionRuns?: boolean } = {}) => {
	mockStartTransition.mockImplementation((scope) => {
		if (transitionRuns) {
			scope();
		}
	});

	const loaded: { strictMode?: unknown; startClient?: unknown } = {};

	jest.isolateModules(() => {
		require('#src/client.tsx');
		loaded.strictMode = (require('react') as { StrictMode: unknown }).StrictMode;
		loaded.startClient = (require('@tanstack/react-start/client') as { StartClient: unknown }).StartClient;
	});

	const [container, element] = (mockHydrateRoot.mock.calls[0] ?? []) as [Document | Element | undefined, ReactElement | undefined];

	return { ...loaded, container, element, transitionCount: mockStartTransition.mock.calls.length };
};

describe('client entry', () => {
	test('hydrates the server-rendered document in place', () => {
		const { container } = setupClientEntry();

		expect(container).toBe(document);
	});

	test('wraps the app in StrictMode', () => {
		const { element, strictMode } = setupClientEntry();

		expect(element?.type).toBe(strictMode);
	});

	test('renders the Start client as the app', () => {
		const { element, startClient } = setupClientEntry();

		const app = (element?.props as { children: ReactElement } | undefined)?.children;

		expect(app?.type).toBe(startClient);
	});

	test('defers hydration into a transition instead of blocking on it', () => {
		const { container, transitionCount } = setupClientEntry({ transitionRuns: false });

		expect(container).toBeUndefined();
		expect(transitionCount).toBe(1);
	});
});

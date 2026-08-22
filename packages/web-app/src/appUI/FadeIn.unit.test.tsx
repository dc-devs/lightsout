import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { FadeIn } from '#src/appUI/FadeIn.tsx';

/**
 * jsdom implements neither `IntersectionObserver` nor `matchMedia`, which is
 * the browser this component is written to survive — so each is installed only
 * by the test that is about it, and removed after.
 */
const setupFadeIn = ({
	observed = false,
	intersecting = true,
	reducedMotion,
	delayMs,
}: {
	observed?: boolean;
	intersecting?: boolean;
	reducedMotion?: boolean;
	delayMs?: number;
} = {}) => {
	const disconnect = jest.fn();
	const observe = jest.fn<(target: Element) => void>();
	const mediaQueries: string[] = [];

	if (observed) {
		// The browser dictates this constructor's shape, so it is written as the
		// platform declares it rather than as this repo writes its own classes.
		class TestObserver {
			constructor(private readonly notify: (entries: { isIntersecting: boolean }[]) => void) {}

			observe(target: Element) {
				observe(target);
				this.notify([{ isIntersecting: intersecting }]);
			}

			disconnect() {
				disconnect();
			}
		}

		Object.assign(globalThis, { IntersectionObserver: TestObserver });
	}

	if (reducedMotion !== undefined) {
		Object.assign(globalThis, {
			matchMedia: (query: string) => {
				mediaQueries.push(query);

				return { matches: reducedMotion };
			},
		});
	}

	const { unmount } = render(
		<FadeIn delayMs={delayMs} className="mt-4">
			<p>the proof section</p>
		</FadeIn>,
	);

	return { disconnect, mediaQueries, observe, unmount };
};

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'IntersectionObserver');
	Reflect.deleteProperty(globalThis, 'matchMedia');
});

describe('FadeIn', () => {
	test('shows its children at once in a browser with no intersection observer, rather than hiding them forever', () => {
		setupFadeIn();

		const content = screen.getByText('the proof section');

		expect(content.parentElement?.className).toContain('opacity-100');
	});

	test('shows them at once for a reader who asked for reduced motion', () => {
		setupFadeIn({ observed: true, reducedMotion: true });

		const content = screen.getByText('the proof section');

		expect(content.parentElement?.className).toContain('opacity-100');
	});

	test('asks the browser about reduced motion, and about no other preference', () => {
		const { mediaQueries } = setupFadeIn({ observed: true, reducedMotion: false });

		expect(mediaQueries).toEqual(['(prefers-reduced-motion: reduce)']);
	});

	test('reveals them once they scroll into view, and stops watching', () => {
		const { disconnect } = setupFadeIn({ observed: true, reducedMotion: false });

		const content = screen.getByText('the proof section');

		expect(content.parentElement?.className).toContain('opacity-100');
		expect(disconnect).toHaveBeenCalled();
	});

	test('keeps them hidden while they are still below the fold', () => {
		setupFadeIn({ observed: true, intersecting: false, reducedMotion: false });

		const content = screen.getByText('the proof section');

		expect(content.parentElement?.className).toContain('opacity-0');
	});

	test('watches the element it wrapped, so the reveal answers to that content rather than to the page', () => {
		const { observe } = setupFadeIn({ observed: true, reducedMotion: false });

		const content = screen.getByText('the proof section');

		expect(observe.mock.calls[0]?.[0]).toBe(content.parentElement);
	});

	test('stops watching when it leaves the page before it ever came into view', () => {
		const { disconnect, unmount } = setupFadeIn({ observed: true, intersecting: false, reducedMotion: false });

		unmount();

		expect(disconnect).toHaveBeenCalledTimes(1);
	});

	test('staggers against its neighbours by the delay it was given', () => {
		setupFadeIn({ delayMs: 150 });

		const content = screen.getByText('the proof section');

		expect(content.parentElement?.style.transitionDelay).toBe('150ms');
	});

	test('lets a caller class through', () => {
		setupFadeIn();

		const content = screen.getByText('the proof section');

		expect(content.parentElement?.className).toContain('mt-4');
	});
});

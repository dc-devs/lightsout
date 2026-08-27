import { afterEach, describe, expect, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getSprawlDataset, SprawlComparison } from '#src/features/sprawl/index.ts';

const realRequest = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

/**
 * The loop is driven by hand for the reason `SprawlChart`'s suite gives: jsdom's
 * own frames land outside React's act boundary.
 *
 * `reducedMotion` left out installs no `matchMedia` at all, which is the browser
 * jsdom actually is and the one a server render behaves like.
 */
const setupComparison = ({ reducedMotion }: { reducedMotion?: boolean } = {}) => {
	const ticks: FrameRequestCallback[] = [];

	if (reducedMotion !== undefined) {
		Object.assign(globalThis, { matchMedia: () => ({ matches: reducedMotion }) });
	}
	Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => ticks.push(callback), cancelAnimationFrame: () => undefined });

	const { container } = render(<SprawlComparison className="mt-8" />);

	return { container, scrubber: screen.getByLabelText('Commit'), ticks };
};

afterEach(() => {
	Object.assign(globalThis, { requestAnimationFrame: realRequest, cancelAnimationFrame: realCancel });
	Reflect.deleteProperty(globalThis, 'matchMedia');
});

describe('SprawlComparison', () => {
	test('says the top lane is a counterfactual, so the README never shows it unlabelled', () => {
		setupComparison();

		expect(screen.getByText('Top: the same commits with every split undone. Bottom: what actually happened.')).toBeInTheDocument();
	});

	test('draws both lanes', () => {
		expect(setupComparison().container.querySelectorAll('svg')).toHaveLength(2);
	});

	test('drives both lanes from one frame, so the two are always the same moment', () => {
		const { container, ticks } = setupComparison();

		act(() => ticks[0](1000));

		const [without, real] = [...container.querySelectorAll('svg')].map((chart) => chart.getAttribute('aria-label'));

		expect(without).toContain('without lightsout');
		expect(real).toContain('with lightsout');
	});

	test('names the commit it is showing', () => {
		setupComparison();

		const last = getSprawlDataset().frames[getSprawlDataset().frames.length - 1];

		expect(screen.getByText(`${last.sha} · ${last.at} · ${last.subject}`)).toBeInTheDocument();
	});

	test('reports where the two lanes end up, which is the comparison the lanes make', () => {
		setupComparison();

		const frames = getSprawlDataset().frames;
		const last = frames[frames.length - 1];

		// The last number sits in its own gradient span, so the counter reads off the paragraph.
		expect(screen.getByText(/^files over cap:/)).toHaveTextContent(`files over cap: ${last.without.overCap} → ${last.with.overCap}`);
	});

	test('spans the whole history with its scrubber, so every commit in the dataset is reachable', () => {
		const { scrubber } = setupComparison();

		expect(scrubber).toHaveAttribute('min', '0');
		expect(scrubber).toHaveAttribute('max', String(getSprawlDataset().frames.length - 1));
	});

	test('spends the brand gradient on the number the two lanes arrive at', () => {
		setupComparison();

		const last = getSprawlDataset().frames[getSprawlDataset().frames.length - 1];
		const payoff = screen.getByText(/^files over cap:/).querySelector('span');

		expect(payoff?.textContent).toBe(String(last.with.overCap));
		expect(payoff?.getAttribute('class')).toContain('var(--brand-gradient)');
	});

	test('moves to the commit a reader scrubbed to', () => {
		const { scrubber } = setupComparison();

		fireEvent.change(scrubber, { target: { value: '0' } });

		const first = getSprawlDataset().frames[0];

		expect(screen.getByText(`${first.sha} · ${first.at} · ${first.subject}`)).toBeInTheDocument();
	});

	test('moves both lanes to the commit a reader scrubbed to, not only the caption under them', () => {
		const { container, scrubber } = setupComparison();

		fireEvent.change(scrubber, { target: { value: '0' } });

		const first = getSprawlDataset().frames[0];
		const drawn = [...container.querySelectorAll('svg')].map((lane) => [...lane.children].filter((child) => child.tagName === 'rect').length);

		expect(drawn).toStrictEqual([Math.min(40, first.without.files.length), Math.min(40, first.with.files.length)]);
	});

	test('hands the history over for good the first time a reader scrubs it', () => {
		const { scrubber, ticks } = setupComparison();
		const asked = ticks.length;

		fireEvent.change(scrubber, { target: { value: '0' } });

		expect(ticks).toHaveLength(asked);
	});

	test('mounts parked on the final frame for a reader who asked for reduced motion', () => {
		const { ticks } = setupComparison({ reducedMotion: true });

		const last = getSprawlDataset().frames[getSprawlDataset().frames.length - 1];

		expect(ticks).toHaveLength(0);
		expect(screen.getByText(`${last.sha} · ${last.at} · ${last.subject}`)).toBeInTheDocument();
	});

	test('lets a caller class through', () => {
		expect(setupComparison().container.firstElementChild?.className).toContain('mt-8');
	});
});

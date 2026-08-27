import { afterEach, describe, expect, test } from '@jest/globals';
import { act, render } from '@testing-library/react';
import { SprawlLane } from '#src/features/sprawl/common/constants/SprawlLane.ts';
import { getSprawlDataset, SprawlChart } from '#src/features/sprawl/index.ts';

const realRequest = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

/**
 * The animation is driven by hand.
 *
 * jsdom's own `requestAnimationFrame` would advance the chart outside React's
 * act boundary, so the callback is captured instead and each tick is a
 * deliberate call — which is also the only way to assert that a parked chart
 * never asks for a frame at all.
 */
const setupChart = ({
	animate,
	frameIndex,
	lane,
	reducedMotion = false,
	animationFrames = true,
}: {
	animate?: boolean;
	frameIndex?: number;
	lane?: SprawlLane;
	reducedMotion?: boolean;
	animationFrames?: boolean;
} = {}) => {
	const ticks: FrameRequestCallback[] = [];
	const cancelled: number[] = [];

	Object.assign(globalThis, { matchMedia: () => ({ matches: reducedMotion }) });

	if (animationFrames) {
		Object.assign(globalThis, {
			requestAnimationFrame: (callback: FrameRequestCallback) => ticks.push(callback),
			cancelAnimationFrame: (handle: number) => cancelled.push(handle),
		});
	} else {
		Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
	}

	const { container, unmount } = render(<SprawlChart animate={animate} frameIndex={frameIndex} lane={lane} className="h-40" />);
	const bars = () => container.querySelectorAll('svg > rect').length;

	return { bars, cancelled, container, ticks, unmount };
};

/**
 * The commit in this history that left `packages/` holding no source at all.
 *
 * Found rather than written down: the dataset is rebuilt from git as the
 * repository grows, and a frame number typed in here would point at a
 * different commit the first time it is.
 */
const emptyFrameIndex = () => {
	const files = new Set<string>();

	return getSprawlDataset().frames.findIndex((frame) => {
		for (const path of frame.with.removedFiles) {
			files.delete(path);
		}

		for (const file of frame.with.files) {
			files.add(file.path);
		}

		return files.size === 0;
	});
};

afterEach(() => {
	Object.assign(globalThis, { requestAnimationFrame: realRequest, cancelAnimationFrame: realCancel });
	Reflect.deleteProperty(globalThis, 'matchMedia');
});

describe('SprawlChart', () => {
	test('draws no more bars than the chart has room for, however many files the repo holds', () => {
		expect(setupChart({ animate: false }).bars()).toBeLessThanOrEqual(40);
	});

	test('names the lane it drew, so a reader on a screen reader knows which history this is', () => {
		const { container } = setupChart({ animate: false, lane: SprawlLane.Without });

		expect(container.querySelector('svg')?.getAttribute('aria-label')).toContain('without lightsout');
	});

	test('draws the history that happened when no lane was asked for, which is the single-lane hero', () => {
		const { container } = setupChart({ animate: false });

		const label = container.querySelector('svg')?.getAttribute('aria-label');

		expect(label).toContain('with lightsout');
		expect(label).not.toContain('without');
	});

	test('lets a caller class through to the drawing', () => {
		expect(setupChart({ animate: false }).container.querySelector('svg')?.getAttribute('class')).toContain('h-40');
	});

	test('parks on the final frame and never asks for a frame when it was told not to animate', () => {
		const { bars, ticks } = setupChart({ animate: false });

		expect(ticks).toHaveLength(0);
		expect(bars()).toBe(40);
	});

	test('parks for a reader who asked their system for reduced motion', () => {
		const { bars, ticks } = setupChart({ reducedMotion: true });

		expect(ticks).toHaveLength(0);
		expect(bars()).toBe(40);
	});

	test('parks in a browser with no animation frames rather than throwing on the way to one', () => {
		expect(setupChart({ animationFrames: false }).bars()).toBe(40);
	});

	test('plays from the beginning of the history once it has a frame', () => {
		const { bars, ticks } = setupChart();

		act(() => ticks[0](1000));

		// It mounted parked on the last commit, which holds more files than the
		// chart draws; one frame in it is drawing the first commit exactly.
		expect(bars()).toBe(Math.min(40, getSprawlDataset().frames[0].with.files.length));
	});

	test('draws at the rate it was asked for rather than on every frame the browser offers', () => {
		const { bars, ticks } = setupChart();

		act(() => ticks[0](1000));

		const first = bars();

		act(() => ticks[1](1000));

		expect(bars()).toBe(first);
	});

	test('stays where the caller put it when the frame is controlled, and starts no loop of its own', () => {
		const { bars, ticks } = setupChart({ frameIndex: 0 });

		expect(ticks).toHaveLength(0);
		expect(bars()).toBeLessThan(40);
	});

	test('stops asking for frames when it leaves the page', () => {
		const { cancelled, unmount } = setupChart();

		unmount();

		expect(cancelled).toHaveLength(1);
	});

	test('draws a folder row for each of the fullest folders, and no more', () => {
		const { container } = setupChart({ animate: false });

		expect(container.querySelectorAll('svg > g')).toHaveLength(8);
	});

	test('draws the cap line and the census line, which are what the bars and rows are measured against', () => {
		const { container } = setupChart({ animate: false });

		expect(container.querySelectorAll('svg > line')).toHaveLength(2);
	});

	test('draws nothing in the failed colour on a frame where the repo was inside every cap', () => {
		const { container } = setupChart({ frameIndex: 0 });

		expect(container.querySelectorAll('[class*="fill-status-failed"]')).toHaveLength(0);
	});

	test('turns a file and a folder over their caps red, which is what the payoff counter counts', () => {
		const frames = getSprawlDataset().frames;
		const worst = frames.reduce((peak, frame, index) => (frame.with.overCap > frames[peak].with.overCap ? index : peak), 0);
		const { container } = setupChart({ frameIndex: worst });

		expect(container.querySelectorAll('svg > rect[class*="fill-status-failed"]').length).toBeGreaterThan(0);
		expect(container.querySelectorAll('svg > g[class*="fill-status-failed"]').length).toBeGreaterThan(0);
	});

	test('reads the committed dataset rather than a shape of its own', () => {
		const { container } = setupChart({ frameIndex: 0 });

		expect(container.querySelectorAll('svg > rect').length).toBe(Math.min(40, getSprawlDataset().frames[0].with.files.length));
	});

	test('draws nothing, and keeps the census line on the box, on a commit that left no files to draw', () => {
		const { bars, container } = setupChart({ frameIndex: emptyFrameIndex() });

		// The census line spans the folder strip, and there is no strip on a frame
		// with no folders — so it collapses to the foot of the box rather than
		// running off to the infinity an empty minimum would hand it.
		const census = container.querySelectorAll('svg > line')[1];

		expect(bars()).toBe(0);
		expect([census.getAttribute('y1'), census.getAttribute('y2')]).toStrictEqual(['20', '20']);
	});
});

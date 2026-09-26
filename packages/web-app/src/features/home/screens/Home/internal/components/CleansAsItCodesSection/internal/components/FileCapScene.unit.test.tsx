import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { FileCapScene } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/FileCapScene.tsx';

/** The scene on its simulated clock; each frame holds 900ms. */
const setupScene = () => {
	jest.useFakeTimers();
	render(<FileCapScene />);

	return { advance: ({ frames }: { frames: number }) => act(() => jest.advanceTimersByTime(frames * 900)) };
};

afterEach(() => {
	jest.useRealTimers();
});

describe('FileCapScene', () => {
	test('starts with the file well under the cap, so there is room to watch it grow', () => {
		setupScene();

		expect(screen.getByText('180 / 250 lines')).toBeInTheDocument();
	});

	test('draws the file as tall as its line count, so growth is something you can see', () => {
		const { container } = render(<FileCapScene />);

		const heights = [...container.querySelectorAll('[style*="height"]')].map((element) => element.getAttribute('style'));

		expect(heights).toContain('height: 180px;');
	});

	test('flags the file once it grows past the cap', () => {
		const { advance } = setupScene();

		advance({ frames: 2 });

		expect(screen.getByText('290 / 250 lines')).toBeInTheDocument();
	});

	test('ends with the same lines split across files that are each under the cap', () => {
		const { advance } = setupScene();

		advance({ frames: 4 });
		const lines = screen.getAllByText(/^\d+ lines$/).map((count) => Number.parseInt(count.textContent ?? '', 10));

		expect({ total: lines.reduce((sum, count) => sum + count, 0), allUnder: lines.every((count) => count <= 250) }).toStrictEqual({
			total: 290,
			allUnder: true,
		});
	});
});

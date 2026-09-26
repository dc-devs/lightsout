import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { FolderCapScene } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/FolderCapScene.tsx';

/** The scene on its simulated clock; each frame holds 900ms. */
const setupScene = () => {
	jest.useFakeTimers();
	render(<FolderCapScene />);

	return { advance: ({ frames }: { frames: number }) => act(() => jest.advanceTimersByTime(frames * 900)) };
};

afterEach(() => {
	jest.useRealTimers();
});

describe('FolderCapScene', () => {
	test('starts with the folder two files under the cap, so the fix comes soon', () => {
		setupScene();

		expect(screen.getByText('18 / 20 files')).toBeInTheDocument();
	});

	test('holds the over-the-cap moment for a second frame, so the reader sees what broke', () => {
		const { advance } = setupScene();

		advance({ frames: 4 });

		expect(screen.getByText('21 files · over the 20-file cap')).toBeInTheDocument();
	});

	test('flags the folder the moment it passes the cap', () => {
		const { advance } = setupScene();

		advance({ frames: 3 });

		expect(screen.getByText('21 files · over the 20-file cap')).toBeInTheDocument();
	});

	test('ends with the same files grouped into sub-folders that are each under the cap', () => {
		const { advance } = setupScene();

		advance({ frames: 6 });
		const counts = screen.getAllByText(/^\d+ files$/).map((count) => Number.parseInt(count.textContent ?? '', 10));

		expect({ total: counts.reduce((sum, count) => sum + count, 0), allUnder: counts.every((count) => count <= 20) }).toStrictEqual({
			total: 21,
			allUnder: true,
		});
	});

	test('starts over once the clean tree has been held', () => {
		const { advance } = setupScene();

		advance({ frames: 10 });

		expect(screen.getByText('18 / 20 files')).toBeInTheDocument();
	});
});

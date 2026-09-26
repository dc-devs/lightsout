import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { ReuseScene } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/ReuseScene.tsx';

/** The scene on its simulated clock, advanced by time rather than by frame, since each moment holds for its own length. */
const setupScene = () => {
	jest.useFakeTimers();
	render(<ReuseScene />);

	return { wait: ({ ms }: { ms: number }) => act(() => jest.advanceTimersByTime(ms)) };
};

afterEach(() => {
	jest.useRealTimers();
});

describe('ReuseScene', () => {
	test('starts with a plan that would add a new helper', () => {
		setupScene();

		expect(screen.getByText('2. Add a msToLabel(ms) helper to RunRow')).toBeInTheDocument();
	});

	test('says what it is looking for while it scans', () => {
		const { wait } = setupScene();

		wait({ ms: 1400 });

		expect(screen.getByText('Scanning for duplicates…')).toBeInTheDocument();
	});

	test('holds the scan long enough to read before the find', () => {
		const { wait } = setupScene();

		wait({ ms: 1400 + 1400 });

		expect(screen.getByText('Scanning for duplicates…')).toBeInTheDocument();
	});

	test('shows the helper the repo already has, once the scan turns it up', () => {
		const { wait } = setupScene();

		wait({ ms: 3500 });

		expect([screen.getByText('Already exists'), screen.getByText('common/utils/formatDuration.ts')]).toHaveLength(2);
	});

	test('ends with the plan updated to reuse it instead', () => {
		const { wait } = setupScene();

		wait({ ms: 5600 });

		expect([screen.getByText('Plan updated'), screen.getByText('2. Reuse formatDuration() from common/utils/')]).toHaveLength(2);
	});

	test('holds the updated plan before starting over', () => {
		const { wait } = setupScene();

		wait({ ms: 5600 + 2800 });

		expect(screen.getByText('Plan updated')).toBeInTheDocument();
	});
});

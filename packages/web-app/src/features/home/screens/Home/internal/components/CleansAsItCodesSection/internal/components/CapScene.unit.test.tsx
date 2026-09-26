import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { SceneStatus } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/constants/SceneStatus.ts';
import { CapScene } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/CapScene.tsx';

const scene = {
	title: 'a limit',
	frames: [
		{ status: SceneStatus.Over, label: 'over' },
		{ status: SceneStatus.Clean, label: 'clean' },
	],
	renderGrowing: (frame: { label: string }) => <p>growing: {frame.label}</p>,
	renderClean: () => <p>cleaned up</p>,
};

const setupScene = () => {
	jest.useFakeTimers();
	render(<CapScene scene={scene} />);

	return { advance: () => act(() => jest.advanceTimersByTime(900)) };
};

afterEach(() => {
	jest.useRealTimers();
});

describe('CapScene', () => {
	test('draws the frames before the clean-up with the growing drawing', () => {
		setupScene();

		expect(screen.getByText('growing: over')).toBeInTheDocument();
	});

	test('switches to the cleaned-up drawing on the clean frames', () => {
		const { advance } = setupScene();

		advance();

		expect(screen.getByText('cleaned up')).toBeInTheDocument();
	});
});

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { LoopingScene } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/LoopingScene.tsx';

const setupScene = () => {
	jest.useFakeTimers();
	render(<LoopingScene title="scene" frames={['first', 'second']} stepMs={100} renderFrame={(frame) => <p>{frame}</p>} />);

	return { advance: ({ frames }: { frames: number }) => act(() => jest.advanceTimersByTime(frames * 100)) };
};

afterEach(() => {
	jest.useRealTimers();
});

describe('LoopingScene', () => {
	test('draws the first frame in a titled window', () => {
		setupScene();

		expect([screen.getByText('scene'), screen.getByText('first')]).toHaveLength(2);
	});

	test('draws each frame in turn and loops back to the first', () => {
		const { advance } = setupScene();

		advance({ frames: 1 });
		const afterOne = screen.getByRole('paragraph').textContent;
		advance({ frames: 1 });
		const afterTwo = screen.getByRole('paragraph').textContent;

		expect({ afterOne, afterTwo }).toStrictEqual({ afterOne: 'second', afterTwo: 'first' });
	});

	test('stays on its last frame and says it has finished, when someone is waiting for it to end', () => {
		jest.useFakeTimers();
		const onFinish = jest.fn<() => void>();
		render(<LoopingScene title="scene" frames={['first', 'second']} stepMs={100} renderFrame={(frame) => <p>{frame}</p>} onFinish={onFinish} />);

		act(() => jest.advanceTimersByTime(200));

		expect({ finished: onFinish.mock.calls.length, shown: screen.getByRole('paragraph').textContent }).toStrictEqual({ finished: 1, shown: 'second' });
	});
});

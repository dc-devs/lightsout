import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useLoopingStep } from '#src/features/home/screens/Home/hooks/useLoopingStep.ts';

const setupLoopingStep = ({ prefersReduced = false, onFinish }: { prefersReduced?: boolean; onFinish?: () => void } = {}) => {
	jest.useFakeTimers();

	if (prefersReduced) {
		Object.assign(globalThis, { matchMedia: () => ({ matches: true }) });
	}

	const { result } = renderHook(() => useLoopingStep({ stepCount: 3, stepMs: 100, onFinish }));
	const advance = ({ steps }: { steps: number }) => act(() => jest.advanceTimersByTime(steps * 100));

	return { result, advance };
};

afterEach(() => {
	jest.useRealTimers();
	Reflect.deleteProperty(globalThis, 'matchMedia');
});

describe('useLoopingStep', () => {
	test('starts on the first frame', () => {
		const { result } = setupLoopingStep();

		expect(result.current).toBe(0);
	});

	test('moves one frame on each tick', () => {
		const { result, advance } = setupLoopingStep();

		advance({ steps: 2 });

		expect(result.current).toBe(2);
	});

	test('goes back to the start after the last frame', () => {
		const { result, advance } = setupLoopingStep();

		advance({ steps: 3 });

		expect(result.current).toBe(0);
	});

	test('holds the last frame, and only that, for a reader who asked for less motion', () => {
		const { result, advance } = setupLoopingStep({ prefersReduced: true });

		advance({ steps: 5 });

		expect(result.current).toBe(2);
	});

	test('holds its last frame for its full time, then says it has finished instead of looping, when someone is waiting', () => {
		const onFinish = jest.fn<() => void>();
		const { result, advance } = setupLoopingStep({ onFinish });

		advance({ steps: 2 });
		const lastFrameBeforeEnd = { step: result.current, finished: onFinish.mock.calls.length };
		advance({ steps: 1 });

		expect({ lastFrameBeforeEnd, afterEnd: { step: result.current, finished: onFinish.mock.calls.length } }).toStrictEqual({
			lastFrameBeforeEnd: { step: 2, finished: 0 },
			afterEnd: { step: 2, finished: 1 },
		});
	});
});

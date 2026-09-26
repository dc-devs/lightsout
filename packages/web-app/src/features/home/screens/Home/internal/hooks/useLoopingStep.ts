import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '#src/features/home/screens/Home/internal/hooks/usePrefersReducedMotion.ts';

interface Params {
	/** How many frames the animation has. */
	stepCount: number;
	/** How long each frame holds. */
	stepMs: number;
	/** Called when the last frame has held its full time. Given, the animation stays on its last frame for the caller to move on; left out, it loops back to the start. */
	onFinish?: () => void;
}

/**
 * The frame an animation is on, advancing on one timer.
 *
 * The end of the last frame is decided by that same timer, and handed to
 * `onFinish` when there is one — so whatever moves on when the animation ends
 * keeps the animation's own time, with no second clock to race it.
 *
 * A reader who asked for less motion gets the last frame and nothing else —
 * every animation here ends on the finished, cleaned-up state, so that is the
 * one frame that still tells the story.
 */
export const useLoopingStep = ({ stepCount, stepMs, onFinish }: Params): number => {
	const prefersReduced = usePrefersReducedMotion();
	const [step, setStep] = useState(0);
	const stepRef = useRef(0);
	// The latest listener, read when the timer fires, so a caller passing a new
	// function does not restart the animation.
	const onFinishRef = useRef(onFinish);

	useEffect(() => {
		onFinishRef.current = onFinish;
	});

	useEffect(() => {
		if (prefersReduced) {
			setStep(stepCount - 1);

			return;
		}

		const timer = setInterval(() => {
			const next = stepRef.current + 1;

			if (next < stepCount) {
				stepRef.current = next;
				setStep(next);
			} else if (onFinishRef.current === undefined) {
				stepRef.current = 0;
				setStep(0);
			} else {
				onFinishRef.current();
			}
		}, stepMs);

		return () => clearInterval(timer);
	}, [prefersReduced, stepCount, stepMs]);

	return step;
};

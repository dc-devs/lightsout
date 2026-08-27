import { useEffect, useState } from 'react';
import type { SprawlFrame } from '#src/features/sprawl/common/contracts/SprawlFrame.ts';
import { buildSprawlFrameSchedule } from '#src/features/sprawl/common/rendering/buildSprawlFrameSchedule.ts';

interface Params {
	frames: SprawlFrame[];
	/** False parks on the final frame and never starts the loop — a controlled chart, `animate={false}`, or the server render. */
	enabled: boolean;
}

/**
 * Plays a lane's frames, and hands back the scrubber that takes over from it.
 *
 * The chart and the two-lane comparison both need the same three behaviours —
 * play at the rate the README GIF is encoded at, hold a refactor marker so the
 * move is legible, and stop for good the first time a reader drags the
 * scrubber — so the loop lives here rather than being written twice and
 * drifting.
 *
 * It mounts parked on the final frame. That is what the server renders, and it
 * is also what a reader who asked for reduced motion keeps: the animation is
 * the argument, but the last frame alone still makes it.
 *
 * @param frames - the frames to play, oldest first
 * @param enabled - whether this hook owns the frame at all
 */
export const useSprawlFrameLoop = ({ frames, enabled }: Params): { frameIndex: number; scrubTo: (params: { index: number }) => void } => {
	const [frameIndex, setFrameIndex] = useState(frames.length - 1);
	const [scrubbed, setScrubbed] = useState(false);

	useEffect(() => {
		const reduced = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (!enabled || scrubbed || reduced || typeof globalThis.requestAnimationFrame !== 'function') {
			return;
		}

		// Twelve a second, the rate `scripts/renderSprawlGif.mjs` encodes at, so
		// the page and the README image play the same history at the same speed.
		const frameDurationMs = 1000 / 12;
		const schedule = buildSprawlFrameSchedule({ frames });
		let handle = 0;
		let tick = 0;
		let drawnAt = 0;

		const advance = (now: number) => {
			if (now - drawnAt >= frameDurationMs) {
				drawnAt = now;
				setFrameIndex(schedule[tick % schedule.length]);
				tick += 1;
			}

			handle = globalThis.requestAnimationFrame(advance);
		};

		handle = globalThis.requestAnimationFrame(advance);

		return () => globalThis.cancelAnimationFrame(handle);
	}, [enabled, frames, scrubbed]);

	return {
		frameIndex,
		scrubTo: ({ index }: { index: number }) => {
			setScrubbed(true);
			setFrameIndex(index);
		},
	};
};

import type { SprawlFrame } from '#src/features/sprawl/common/contracts/SprawlFrame.ts';

interface Params {
	frames: SprawlFrame[];
}

/**
 * Frame indices in the order they play, with every refactor marker repeated.
 *
 * A move happens in a single commit, so at twelve frames a second it would go
 * by in one eighty-third of a second and read as a glitch. Holding the marker
 * is what makes the split visible, and the page and the README GIF hold it for
 * the same count because they walk this same list.
 *
 * @param frames - the frames to play, oldest first
 */
export const buildSprawlFrameSchedule = ({ frames }: Params): number[] => {
	const schedule: number[] = [];

	frames.forEach((frame, index) => {
		// Three ticks: a quarter of a second, long enough to see and short enough
		// that a history of two dozen refactors still plays in ten seconds.
		const holds = frame.isRefactorMarker ? 3 : 1;

		for (let hold = 0; hold < holds; hold += 1) {
			schedule.push(index);
		}
	});

	return schedule;
};

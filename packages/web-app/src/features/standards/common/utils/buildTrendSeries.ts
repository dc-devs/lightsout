import type { StandardsTrendPoint } from '@lightsout/engine';
import type { TrendSeries } from '#src/features/standards/common/types/TrendSeries.ts';

interface Params {
	points: StandardsTrendPoint[];
}

/**
 * One series as SVG path data: position across the box by index, height
 * measured down from the peak.
 *
 * A run of snapshots that all read zero has no peak to measure against, so
 * every point sits on the floor rather than dividing by it.
 */
const buildPath = ({ counts, peak }: { counts: number[]; peak: number }) =>
	counts
		.map((count, index) => `${index === 0 ? 'M' : 'L'}${(index / (counts.length - 1)).toFixed(4)},${(peak === 0 ? 1 : 1 - count / peak).toFixed(4)}`)
		.join(' ');

/**
 * Trend points reduced to two SVG polylines in a unit box, ready to scale to
 * any size.
 *
 * Fewer than two points is not a trend, and drawing a single snapshot as a line
 * would claim a direction nothing measured — so the caller is handed nothing
 * and says so in words instead. Coordinates are normalized to a 0–1 box so the
 * chart scales them with a `viewBox` and never recomputes on resize.
 *
 * @param points - snapshot counts as the engine returns them: oldest first, already narrowed to one checked path
 */
export const buildTrendSeries = ({ points }: Params): TrendSeries | undefined => {
	if (points.length < 2) {
		return undefined;
	}

	const peak = Math.max(...points.map((point) => point.total));

	return {
		blocking: buildPath({ counts: points.map((point) => point.blocking), peak }),
		total: buildPath({ counts: points.map((point) => point.total), peak }),
		from: points[0].at,
		to: points[points.length - 1].at,
		peak,
	};
};

import { cn } from '#src/common/utils/cn.ts';

interface Props {
	values: number[];
	className?: string;
}

/**
 * A run of numbers as one line in a unit box.
 *
 * The same no-chart-library approach the standards trend chart takes, at tile
 * size: coordinates normalised to a 0–1 box that a `viewBox` scales, so nothing
 * recomputes on resize, and the same `M`/`L` path data so the two charts read
 * as one technique rather than two.
 *
 * Fewer than two points is not a line and is drawn as nothing rather than as a
 * shape that would claim a direction nobody measured. A run that reads zero
 * throughout has no peak to divide by, so every point sits on the floor.
 */
export const Sparkline = ({ values, className }: Props) => {
	if (values.length < 2) {
		return null;
	}

	const peak = Math.max(...values);
	const data = values
		.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index / (values.length - 1)).toFixed(4)},${(peak === 0 ? 1 : 1 - value / peak).toFixed(4)}`)
		.join(' ');

	return (
		<svg viewBox="0 0 1 1" preserveAspectRatio="none" role="img" aria-label="Recent trend" className={cn('h-6 w-full', className)}>
			<path d={data} fill="none" className="stroke-status-failed" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
		</svg>
	);
};

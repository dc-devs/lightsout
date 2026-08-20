import type { StandardsTrendPoint } from '@lightsout/engine';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';
import { buildTrendSeries } from '#src/features/standards/common/utils/buildTrendSeries.ts';

/** Where the grid rules sit in the unit box — the peak, half of it, and zero. */
const gridLines = [0, 0.5, 1];

interface Props {
	points: StandardsTrendPoint[];
	/** The subpath the latest snapshot covered; only points that checked the same path are plotted. */
	path: string;
}

/**
 * Open findings over the checks this repo has run, as two lines.
 *
 * Only snapshots of the same subpath are plotted: a whole-repo total and a
 * single-package total are different measurements, and drawing them as one line
 * would invent a rise or a fall that nobody caused. Snapshots left out for that
 * reason are counted in a line beneath the chart rather than dropped silently.
 *
 * Drawn as inline SVG in a 0–1 box scaled by `viewBox`, so the chart resizes
 * with its card and no charting dependency is added for two polylines.
 */
export const StandardsTrendChart = ({ points, path }: Props) => {
	const comparable = points.filter((point) => point.path === path);
	const omitted = points.length - comparable.length;
	const series = buildTrendSeries({ points: comparable });

	return (
		<div className="flex flex-col gap-2">
			{series === undefined ? (
				<p className="text-muted-foreground text-sm">
					{formatCount({ count: comparable.length, noun: 'snapshot' })} of <span className="font-mono">{path}</span> on record — a trend needs at least two.
				</p>
			) : (
				<>
					{/* `preserveAspectRatio="none"` stretches the unit box to the card; the strokes opt out of that stretch so the lines stay even. */}
					<svg viewBox="0 0 1 1" preserveAspectRatio="none" role="img" aria-label="Open findings over time" className="h-40 w-full">
						{gridLines.map((y) => (
							<line key={y} x1={0} y1={y} x2={1} y2={y} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
						))}
						<path d={series.total} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
						<path d={series.blocking} fill="none" className="stroke-status-failed" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
					</svg>
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-muted-foreground text-xs">
						<span className="flex items-center gap-3">
							<span className="flex items-center gap-1.5">
								<span aria-hidden="true" className="h-0.5 w-4 bg-status-failed" />
								blocking
							</span>
							<span className="flex items-center gap-1.5">
								<span aria-hidden="true" className="h-0.5 w-4 bg-muted-foreground" />
								total
							</span>
						</span>
						<span>
							{formatRelativeTime({ at: series.from })} → {formatRelativeTime({ at: series.to })} · peak {series.peak}
						</span>
					</div>
				</>
			)}
			{omitted === 0 ? null : (
				<p className="text-muted-foreground text-xs">
					{formatCount({ count: omitted, noun: 'snapshot' })} of other paths left out — a whole-repo total and a subfolder total are not one line.
				</p>
			)}
		</div>
	);
};

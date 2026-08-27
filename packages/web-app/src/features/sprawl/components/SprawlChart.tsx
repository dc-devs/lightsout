import { cn } from '#src/common/utils/cn.ts';
import { SprawlLane } from '#src/features/sprawl/common/constants/SprawlLane.ts';
import { sprawlUnitBox } from '#src/features/sprawl/common/constants/sprawlUnitBox.ts';
import { buildSprawlLaneStates } from '#src/features/sprawl/common/rendering/buildSprawlLaneStates.ts';
import { buildSprawlLayout } from '#src/features/sprawl/common/rendering/buildSprawlLayout.ts';
import { getSprawlMaxLines } from '#src/features/sprawl/common/rendering/getSprawlMaxLines.ts';
import { getSprawlDataset } from '#src/features/sprawl/common/utils/getSprawlDataset.ts';
import { useSprawlFrameLoop } from '#src/features/sprawl/hooks/useSprawlFrameLoop.ts';

interface Props {
	/** Which lane to draw; omit for the single-lane hero. */
	lane?: SprawlLane;
	/** Play through the frames; false holds the final frame. Defaults true. */
	animate?: boolean;
	/** Controlled frame index — the two-lane scrubber drives both lanes from one value. */
	frameIndex?: number;
	className?: string;
}

/**
 * One lane of this repository's history: the biggest files as bars, the fullest
 * folders as rows of squares, and the two caps as the lines neither may cross.
 *
 * Every colour is a theme token. A bar over its cap is the failed-status red on
 * every frame it is over rather than flashing once, so the payoff counter
 * counts exactly the red bars a reader can see.
 */
export const SprawlChart = ({ lane = SprawlLane.With, animate = true, frameIndex, className }: Props) => {
	const dataset = getSprawlDataset();
	const states = buildSprawlLaneStates({ dataset, lane });
	const { frameIndex: played } = useSprawlFrameLoop({ frames: dataset.frames, enabled: animate && frameIndex === undefined });
	const index = frameIndex ?? played;
	const layout = buildSprawlLayout({ state: states[index], maxLines: getSprawlMaxLines({ dataset }), caps: dataset.caps, ...sprawlUnitBox });

	return (
		<svg
			viewBox={`0 0 ${sprawlUnitBox.width} ${sprawlUnitBox.height}`}
			role="img"
			aria-label={`Repository file sizes over time, ${lane} lightsout`}
			className={cn('w-full', className)}
		>
			{layout.bars.map((bar) => (
				<rect key={bar.path} x={bar.x} y={bar.y} width={bar.width} height={bar.height} className={bar.overCap ? 'fill-status-failed' : 'fill-brand-from'} />
			))}
			<line x1={0} y1={layout.capY} x2={sprawlUnitBox.width} y2={layout.capY} className="stroke-muted-foreground" strokeWidth={0.15} />
			{layout.folderRows.map((row) => (
				<g key={row.path} className={row.overCap ? 'fill-status-failed' : 'fill-muted-foreground'}>
					{row.squares.map((square) => (
						<rect key={square.x} x={square.x} y={square.y} width={square.size} height={square.size} />
					))}
				</g>
			))}
			<line x1={layout.censusX} y1={layout.censusY} x2={layout.censusX} y2={sprawlUnitBox.height} className="stroke-muted-foreground" strokeWidth={0.15} />
		</svg>
	);
};

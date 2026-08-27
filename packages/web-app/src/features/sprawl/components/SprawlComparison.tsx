import { cn } from '#src/common/utils/cn.ts';
import { SprawlLane } from '#src/features/sprawl/common/constants/SprawlLane.ts';
import { getSprawlDataset } from '#src/features/sprawl/common/utils/getSprawlDataset.ts';
import { SprawlChart } from '#src/features/sprawl/components/SprawlChart.tsx';
import { useSprawlFrameLoop } from '#src/features/sprawl/hooks/useSprawlFrameLoop.ts';

interface Props {
	className?: string;
}

/**
 * The same commits twice: above, with every split undone; below, what actually
 * happened.
 *
 * The caption is part of this component rather than page copy, and
 * `scripts/renderSprawlGif.mjs` draws it into the README image too. The top
 * lane is a counterfactual derived from the bottom one — it never existed —
 * and an unlabelled counterfactual is precisely the thing this product sells
 * against.
 *
 * Both lanes are driven from one frame, so they are always the same moment.
 * The counter beneath them reports the last frame of each lane, which is the
 * comparison the two lanes make; it does not follow the frame being drawn,
 * because where the lanes end up is the claim.
 */
export const SprawlComparison = ({ className }: Props) => {
	const dataset = getSprawlDataset();
	const { frameIndex, scrubTo } = useSprawlFrameLoop({ frames: dataset.frames, enabled: true });
	const frame = dataset.frames[frameIndex];
	const last = dataset.frames[dataset.frames.length - 1];

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<p className="text-muted-foreground text-sm">Top: the same commits with every split undone. Bottom: what actually happened.</p>
			<SprawlChart lane={SprawlLane.Without} frameIndex={frameIndex} />
			<SprawlChart lane={SprawlLane.With} frameIndex={frameIndex} />
			<input
				type="range"
				min={0}
				max={dataset.frames.length - 1}
				value={frameIndex}
				onChange={(event) => scrubTo({ index: Number(event.target.value) })}
				aria-label="Commit"
				className="w-full accent-primary"
			/>
			<p className="truncate font-mono text-muted-foreground text-xs">
				{frame.sha} · {frame.at} · {frame.subject}
			</p>
			<p className="font-semibold text-lg">
				files over cap: {last.without.overCap} → <span className="bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">{last.with.overCap}</span>
			</p>
		</div>
	);
};

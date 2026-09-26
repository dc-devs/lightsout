import { FileCode } from 'lucide-react';
import { cn } from '#src/common/utils/cn.ts';
import { SceneStatus } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/constants/SceneStatus.ts';
import type { SceneProps } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/types/SceneProps.ts';
import { Appear } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/Appear.tsx';
import { LoopingScene } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/LoopingScene.tsx';
import { StatusChip } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/StatusChip.tsx';

/** How long one frame holds. Short, so each moment below can be held for its own length in whole frames. */
const stepMs = 700;

/** One moment of the scene, repeated for as many frames as it should stay on screen. */
const hold = ({ status, chip, ms }: { status: SceneStatus; chip: string; ms: number }) =>
	Array.from({ length: Math.round(ms / stepMs) }, () => ({ status, chip }));

/**
 * Frame by frame: the plan asks for a new helper, the repo is scanned, an
 * existing one turns up, and the plan reuses it. The scan and the find hold
 * long enough to read, and the updated plan longest — the same rhythm as the
 * other two scenes.
 */
const frames = [
	...hold({ status: SceneStatus.Working, chip: 'Drafting the plan', ms: 1400 }),
	...hold({ status: SceneStatus.Fixing, chip: 'Scanning for duplicates…', ms: 2100 }),
	...hold({ status: SceneStatus.Over, chip: 'Already exists', ms: 2100 }),
	...hold({ status: SceneStatus.Clean, chip: 'Plan updated', ms: 3500 }),
];

/** One frame of the planning scene. */
const PlanFrame = ({ status, chip }: (typeof frames)[number]) => {
	const isFound = status === SceneStatus.Over || status === SceneStatus.Clean;
	const isReused = status === SceneStatus.Clean;

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="flex items-center gap-2.5 font-medium font-mono text-drop-navy text-sm">
					<FileCode aria-hidden="true" className="size-5 text-muted-foreground" />
					plan.md
				</p>
				<StatusChip status={status}>{chip}</StatusChip>
			</div>
			<ol className="flex flex-col gap-2.5 font-mono text-sm">
				<li className="text-subtle-foreground">## Steps</li>
				<li className="text-muted-foreground-strong">1. Show each run's duration in RunRow</li>
				<li
					className={cn(
						'rounded-md px-2 py-1 transition-colors duration-500',
						isFound && !isReused && 'bg-status-failed-light text-status-failed-foreground line-through',
						isReused && 'bg-status-passed-light text-status-passed-foreground',
						!isFound && 'text-muted-foreground-strong',
					)}
				>
					{isReused ? '2. Reuse formatDuration() from common/utils/' : '2. Add a msToLabel(ms) helper to RunRow'}
				</li>
				<li className="text-muted-foreground-strong">3. Test the new column</li>
			</ol>
			{isFound ? (
				<Appear className="flex flex-col gap-2 rounded-xl border border-primary-tint-border bg-primary-tint/60 p-4">
					<p className="font-semibold text-primary-hover text-xs uppercase tracking-wide">Found in your repo</p>
					<p className="font-mono text-drop-navy text-sm">common/utils/formatDuration.ts</p>
					<p className="font-mono text-muted-foreground text-xs">export const formatDuration = (ms) =&gt; …</p>
				</Appear>
			) : null}
		</div>
	);
};

/**
 * A plan about to add a helper the repo already has, caught before any code
 * is written — planning searches for existing code, and the plan is changed to
 * reuse what it finds.
 */
export const ReuseScene = ({ onFinish }: SceneProps) => (
	<LoopingScene
		title="Planning · catch duplication before coding"
		frames={frames}
		stepMs={stepMs}
		renderFrame={(frame) => <PlanFrame status={frame.status} chip={frame.chip} />}
		onFinish={onFinish}
	/>
);

import type { RunStepView } from '@lightsout/engine';
import { formatDuration } from '@lightsout/shared';
import { runStatusFamilies } from '#src/common/constants/runStatusFamilies.ts';

// The background for each colour family. Spelled out rather than interpolated
// because Tailwind only emits classes it can read in the source.
const segmentColors = {
	neutral: 'bg-muted',
	running: 'bg-status-running',
	passed: 'bg-status-passed',
	failed: 'bg-status-failed',
	paused: 'bg-status-paused',
	escalated: 'bg-status-escalated',
} as const;

interface Props {
	steps: RunStepView[];
	/** Sum of the step durations, which is what each segment is measured against. */
	activeMs: number;
}

/**
 * Where the time went: one segment per step, as wide as its share of the run's
 * active time.
 *
 * The segments deliberately need not fill the strip — the shortfall is the run
 * sitting between steps, and hiding it by normalising to 100% would claim time
 * the steps did not spend. A step with no recorded duration still gets a floor
 * so it stays clickable rather than collapsing to nothing.
 */
export const RunTimeline = ({ steps, activeMs }: Props) => {
	const minimumWidthPercent = 3;
	const denominator = activeMs > 0 ? activeMs : 1;

	return steps.length === 0 ? (
		<p className="text-muted-foreground text-sm">No steps recorded yet.</p>
	) : (
		<div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-md">
			{steps.map((step) => (
				<a
					key={step.id}
					href={`#step-${step.id}`}
					title={`${step.id} · ${formatDuration({ ms: step.durationMs })}`}
					style={{ width: `${Math.max((100 * (step.durationMs ?? 0)) / denominator, minimumWidthPercent)}%` }}
					className={`${segmentColors[runStatusFamilies[step.status]]} min-w-1 rounded-sm opacity-80 transition-opacity hover:opacity-100`}
				>
					<span className="sr-only">{step.id}</span>
				</a>
			))}
		</div>
	);
};

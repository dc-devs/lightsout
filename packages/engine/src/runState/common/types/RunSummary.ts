import type { RunUsage } from '#src/contracts/index.ts';
import type { StepSummary } from '#src/runState/common/types/StepSummary.ts';

/** A run's evidence aggregated into one report card — see {@link summarizeRun}. */
export interface RunSummary {
	wallMs: number;
	/** Sum of step durations — actual working time, unlike wall, which spans idle gaps between a failure and its resume. */
	activeMs: number;
	gateMs: number;
	usage: RunUsage | undefined;
	/** Share of all input the model read from cache — the run's cost-efficiency dial. */
	cacheReadShare: number | undefined;
	steps: StepSummary[];
	gates: { commands: number; reruns: number; skipped: number };
	/** Final messages that failed their contract and cost a re-emit retry. */
	rejectedReports: number;
	frictionByArea: { area: string; count: number }[];
}

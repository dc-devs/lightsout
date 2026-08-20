import type { RunStatus } from '#src/contracts/index.ts';

/** One step's row in a run's report card: its outcome, timing, agent spend, and attributed files. */
export interface StepSummary {
	id: string;
	status: RunStatus;
	attempts: number;
	durationMs: number | undefined;
	changedFiles: string[] | undefined;
	invocations: number;
	outputTokens: number;
	costUsd: number;
}

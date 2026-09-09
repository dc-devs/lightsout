import type { RunStatus, StepRecord } from '#src/contracts/index.ts';
import type { CleanupSummary } from '#src/runState/index.ts';

/** One row of a run's progress table — see {@link getRunProgress}. */
export interface RunProgressRow {
	/** The step id, exactly as the pipeline names it; the literal `ship` on the ship row. */
	id: string;
	/** Undefined on a row the run has not reached — a step its pipeline declared but never started. */
	status: RunStatus | undefined;
	/** Invocation attempts recorded for this step. 0 on a row the run has not reached. */
	attempts: number;
	/** Active time in this step. Undefined on a row the run has not reached, and on the ship row, whose result records no duration. For the running step of a live run this is the persisted total plus the time since the manifest's last write. */
	durationMs: number | undefined;
	verification: StepRecord['verification'];
	/** The cleanup outcome this step recorded; undefined on every step that is not the refactor step, and on a row the run has not reached. */
	cleanup: CleanupSummary | undefined;
}

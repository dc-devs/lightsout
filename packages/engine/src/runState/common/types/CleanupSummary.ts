import type { CleanupEndReason } from '#src/contracts/index.ts';

/** What an implementation run's bounded cleanup pass spent and what it left behind — see {@link buildCleanupSummary}. */
export interface CleanupSummary {
	/** Cleanup executor rounds actually spent; 0 when no executor was invoked. */
	rounds: number;
	/** Why cleanup ended, exactly as the step recorded it; undefined while cleanup is still running or parked mid-loop. */
	endReason: CleanupEndReason | undefined;
	/** Deterministic blocking findings this run introduced or measurably worsened that still stand. */
	remainingFindings: number;
	/** Findings recorded but never handed to the executor: inherited debt and findings whose provenance could not be established. */
	carriedFindings: number;
	/** Judgment-review findings from the review that observed the final edits. */
	reviewFindings: number;
	/** Cleanup-agent attempts that timed out or returned nothing usable. */
	failures: number;
}
